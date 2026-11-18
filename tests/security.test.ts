import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { tokenMatchesAccount } from "../lib/session-rules.ts";
import { deriveKey, hmacHex } from "../lib/keys.ts";
import { signReferralCode, verifyReferralSignature } from "../lib/referral-signature.ts";
import { accountRoleAllowed } from "../lib/account-flags.ts";

test("independent customer role is opt-in and never inherits workshop or marketer privileges", () => {
  assert.equal(accountRoleAllowed("customer"), false, "default account APIs reject independent customers");
  assert.equal(accountRoleAllowed("customer", { allowCustomer: true }), true, "only explicitly opted-in account APIs accept them");
  assert.equal(accountRoleAllowed("workshop"), true);
  assert.equal(accountRoleAllowed("marketer"), true);
  assert.equal(accountRoleAllowed("admin"), false);
  assert.equal(accountRoleAllowed("admin", { allowAdmin: true }), true);
});

function withSecret<T>(secret: string | undefined, fn: () => T): T {
  const before = process.env.AUTH_SECRET;
  if (secret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = secret;
  try { return fn(); } finally { if (before === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = before; }
}

test("token versioning: an old token stops working after the version is raised, a new one works", () => {
  const state = { version: 3, active: true };
  assert.equal(tokenMatchesAccount(3, state), true, "token issued at the current version");
  assert.equal(tokenMatchesAccount(2, state), false, "token issued before the bump (password change / logout-all)");
  assert.equal(tokenMatchesAccount(4, state), false, "a token claiming a future version");
  assert.equal(tokenMatchesAccount(undefined, { version: 0, active: true }), true, "old tokens without v keep working until the first bump");
  assert.equal(tokenMatchesAccount(undefined, state), false, "old tokens without v die after a bump");
});

test("token versioning: deactivated or missing accounts never match", () => {
  assert.equal(tokenMatchesAccount(0, { version: 0, active: false }), false);
  assert.equal(tokenMatchesAccount(0, null), false);
});

test("derived keys are separated by purpose and by secret", () => {
  withSecret("secret-A", () => {
    assert.notEqual(deriveKey("referral-v1").toString("hex"), deriveKey("otp-v1").toString("hex"));
    assert.equal(deriveKey("referral-v1").toString("hex"), deriveKey("referral-v1").toString("hex"));
    assert.notEqual(deriveKey("referral-v1").toString("hex"), crypto.createHash("sha256").update("secret-A").digest("hex"));
  });
  const a = withSecret("secret-A", () => hmacHex("referral-v1", "x"));
  const b = withSecret("secret-B", () => hmacHex("referral-v1", "x"));
  assert.notEqual(a, b);
  assert.throws(() => withSecret(undefined, () => deriveKey("referral-v1")));
});

test("referral signature: new and legacy signatures verify; other codes, other secrets and garbage do not", () => {
  withSecret("secret-A", () => {
    const code = "EURO1234";
    const fresh = signReferralCode(code);
    const legacy = crypto.createHmac("sha256", "secret-A").update(`workshop-referral:${code}`).digest("hex");
    assert.notEqual(fresh, legacy, "the new signature uses a derived key");
    assert.equal(verifyReferralSignature(code, fresh), true);
    assert.equal(verifyReferralSignature(code, legacy), true, "links shared before the change keep working");
    assert.equal(verifyReferralSignature("EURO9999", fresh), false, "a signature does not move to another code");
    assert.equal(verifyReferralSignature(code, ""), false);
    assert.equal(verifyReferralSignature(code, "zz"), false);
    assert.equal(verifyReferralSignature("", fresh), false);
    const forged = withSecret("secret-B", () => signReferralCode(code));
    assert.equal(verifyReferralSignature(code, forged), false, "a signature made with another secret");
    const otherPurpose = hmacHex("otp-v1", `workshop-referral:${code}`);
    assert.equal(verifyReferralSignature(code, otherPurpose), false, "a signature of another purpose cannot be replayed");
  });
});

import { resetWindow } from "../lib/admin-reset-rules.ts";

test("admin reset is open only with a long token and an expiry within the next 24 hours", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const token = "t".repeat(32);
  const inHours = (h: number) => new Date(now + h * 3600_000).toISOString();
  assert.equal(resetWindow({ token, expiresAt: inHours(2) }, now), "open");
  assert.equal(resetWindow({ token, expiresAt: inHours(-1) }, now), "expired");
  assert.equal(resetWindow({ token, expiresAt: inHours(48) }, now), "disabled", "too far ahead: a forgotten far-future date is ignored");
  assert.equal(resetWindow({ token }, now), "disabled", "no expiry");
  assert.equal(resetWindow({ token, expiresAt: "soon" }, now), "disabled");
  assert.equal(resetWindow({ token: "short", expiresAt: inHours(1) }, now), "disabled");
  assert.equal(resetWindow({ expiresAt: inHours(1) }, now), "disabled");
});
