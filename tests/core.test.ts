import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRateLimiter } from "../lib/rate-limit-core.ts";
import { base32Decode, base32Encode, generateRecoveryCodes, generateTotpSecret, openSecret, sealSecret, totpCode, verifyTotp } from "../lib/totp.ts";

const rule = { limit: 3, windowSeconds: 60, blockSeconds: 120 };

test("rate limiter allows up to the limit then blocks for blockSeconds", () => {
  let now = 1_000_000;
  const limiter = new MemoryRateLimiter(100, () => now);
  assert.equal(limiter.hit("k", rule).allowed, true);
  assert.equal(limiter.hit("k", rule).allowed, true);
  assert.equal(limiter.hit("k", rule).allowed, true);
  const blocked = limiter.hit("k", rule);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter, 120);
  now += 119_000;
  assert.equal(limiter.hit("k", rule, false).allowed, false);
  now += 2_000;
  assert.equal(limiter.hit("k", rule).allowed, true);
});

test("peek does not count an attempt and reset clears the key", () => {
  const limiter = new MemoryRateLimiter(100, () => 5_000);
  for (let i = 0; i < 10; i++) assert.equal(limiter.hit("peek", rule, false).allowed, true);
  for (let i = 0; i < 4; i++) limiter.hit("a", rule);
  assert.equal(limiter.hit("a", rule, false).allowed, false);
  limiter.reset("a");
  assert.equal(limiter.hit("a", rule).allowed, true);
});

test("window expiry restarts the counter", () => {
  let now = 0;
  const limiter = new MemoryRateLimiter(100, () => now);
  limiter.hit("w", rule);
  limiter.hit("w", rule);
  now += 61_000;
  assert.equal(limiter.hit("w", rule).allowed, true);
  assert.equal(limiter.hit("w", rule).allowed, true);
  assert.equal(limiter.hit("w", rule).allowed, true);
  assert.equal(limiter.hit("w", rule).allowed, false);
});

test("store stays bounded under many distinct keys", () => {
  const limiter = new MemoryRateLimiter(50, () => 10);
  for (let i = 0; i < 500; i++) limiter.hit(`k${i}`, rule);
  assert.ok(limiter.size <= 50);
});

test("TOTP matches the RFC 6238 SHA-1 test vector", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(totpCode(secret, 59_000, 8), "94287082");
  assert.equal(totpCode(secret, 1111111109_000, 8), "07081804");
  assert.equal(totpCode(secret, 59_000), "287082");
});

test("TOTP verification accepts +-1 step only", () => {
  const secret = generateTotpSecret();
  const t = 1_700_000_000_000;
  const code = totpCode(secret, t);
  assert.notEqual(verifyTotp(secret, code, t), null);
  assert.notEqual(verifyTotp(secret, code, t + 30_000), null);
  assert.equal(verifyTotp(secret, code, t + 120_000), null);
  assert.equal(verifyTotp(secret, "12345", t), null);
  assert.equal(verifyTotp(secret, "abcdef", t), null);
});

test("base32 round-trips and sealed secrets need the right key", () => {
  const raw = Buffer.from("hello-world-1234");
  assert.deepEqual(base32Decode(base32Encode(raw)), raw);
  const key = Buffer.alloc(32, 7);
  const sealed = sealSecret("JBSWY3DPEHPK3PXP", key);
  assert.equal(openSecret(sealed, key), "JBSWY3DPEHPK3PXP");
  assert.throws(() => openSecret(sealed, Buffer.alloc(32, 8)));
});

test("recovery codes are unique and well formed", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const code of codes) assert.match(code, /^[0-9a-f]{5}-[0-9a-f]{5}$/);
});

import { referralFlags } from "../lib/referral-rules.ts";

test("referral flags: self referral, burst and shared address", () => {
  const base = { newUserPhone: "0991234567", referrerPhone: "963991234567", signupsLastHour: 1, signupsSameAddressLastDay: 1 };
  assert.deepEqual(referralFlags(base), ["self_referral"]);
  assert.deepEqual(referralFlags({ ...base, referrerPhone: "0944444444", signupsLastHour: 5 }), ["burst"]);
  assert.deepEqual(referralFlags({ ...base, referrerPhone: null, signupsSameAddressLastDay: 3 }), ["shared_address"]);
  assert.deepEqual(referralFlags({ ...base, referrerPhone: "0944444444" }), []);
});

import { newPasswordError } from "../lib/password-policy.ts";

test("password policy: 8 characters for new passwords", () => {
  assert.notEqual(newPasswordError("1234567"), null);
  assert.equal(newPasswordError("12345678"), null);
  assert.notEqual(newPasswordError("x".repeat(129)), null);
  assert.notEqual(newPasswordError(undefined), null);
});

import { receiptDecision } from "../lib/receipt-rules.ts";

test("receipt reuse: only after a never-approved cancellation", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  const fresh = "2026-11-13T11:59:00Z";
  const old = "2026-11-13T11:00:00Z";
  assert.equal(receiptDecision({ order_id: "o1", locked_at: null, created_at: old }, "cancelled", now), "reuse");
  assert.equal(receiptDecision({ order_id: "o1", locked_at: null, created_at: old }, "pending", now), "blocked");
  assert.equal(receiptDecision({ order_id: "o1", locked_at: null, created_at: old }, "approved", now), "blocked");
  assert.equal(receiptDecision({ order_id: "o1", locked_at: "2026-11-13T11:30:00Z", created_at: old }, "cancelled", now), "blocked");
  assert.equal(receiptDecision({ order_id: null, locked_at: null, created_at: fresh }, null, now), "blocked");
  assert.equal(receiptDecision({ order_id: null, locked_at: null, created_at: old }, null, now), "stale_claim");
});
