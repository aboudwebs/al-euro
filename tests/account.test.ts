import test from "node:test";
import assert from "node:assert/strict";
import { accountFlags, accountRoleAllowed } from "../lib/account-flags.ts";
import { commissionTotals } from "../lib/commission-math.ts";

test("flags: an account made with e-mail has no password and no phone", () => {
  assert.deepEqual(accountFlags({ phone: null, password_hash: null, phone_verification_required: true }), { has_password: false, phone_verified: false });
  assert.deepEqual(accountFlags({ phone: "", password_hash: "", phone_verification_required: true }), { has_password: false, phone_verified: false });
  assert.deepEqual(accountFlags({}), { has_password: false, phone_verified: false });
});

test("flags: a phone counts as verified unless the server still waits for its SMS code", () => {
  assert.equal(accountFlags({ phone: "963991234567", phone_verification_required: false }).phone_verified, true);
  assert.equal(accountFlags({ phone: "963991234567" }).phone_verified, true, "old accounts and old schemas have no flag");
  assert.equal(accountFlags({ phone: "963991234567", phone_verification_required: true }).phone_verified, false);
  assert.equal(accountFlags({ phone: "   ", phone_verification_required: false }).phone_verified, false);
});

test("flags: has_password follows the stored hash and never exposes it", () => {
  const flags = accountFlags({ phone: "963991234567", password_hash: "scrypt$abc", phone_verification_required: false });
  assert.deepEqual(flags, { has_password: true, phone_verified: true });
  assert.ok(!JSON.stringify(flags).includes("scrypt"));
});

test("account endpoints: workshops and marketers by default; customers and admins only when explicitly allowed", () => {
  assert.equal(accountRoleAllowed("workshop"), true);
  assert.equal(accountRoleAllowed("marketer"), true);
  assert.equal(accountRoleAllowed("customer"), false);
  assert.equal(accountRoleAllowed("customer", { allowCustomer: true }), true);
  assert.equal(accountRoleAllowed("admin"), false);
  assert.equal(accountRoleAllowed("admin", { allowAdmin: true }), true);
  assert.equal(accountRoleAllowed("worker", { allowAdmin: true }), false, "workers stay out");
  assert.equal(accountRoleAllowed(undefined, { allowAdmin: true }), false);
  assert.equal(accountRoleAllowed("workshop", { allowAdmin: false }), true);
});

test("commission totals: the paid part of a partly paid commission is not counted as still due", () => {
  // 100 earned; 40 already paid by a partial payout, the rest is still "available".
  const totals = commissionTotals(
    [{ id: "c1", status: "available", commission_amount: 100 }],
    [{ commission_id: "c1", amount: 40, status: "paid" }],
  );
  assert.deepEqual(totals, { held: 0, available: 60, payout_requested: 0, paid: 40 });
});

test("commission totals: pending requests are reserved, released ones are due again", () => {
  const totals = commissionTotals(
    [
      { id: "c1", status: "payout_requested", commission_amount: 100 },
      { id: "c2", status: "available", commission_amount: 50 },
    ],
    [
      { commission_id: "c1", amount: 30, status: "paid" },
      { commission_id: "c1", amount: 50, status: "pending" },
      { commission_id: "c2", amount: 50, status: "released" },
    ],
  );
  assert.deepEqual(totals, { held: 0, available: 20 + 50, payout_requested: 50, paid: 30 });
});

test("commission totals: held stays held; legacy rows without allocations count by their status", () => {
  const totals = commissionTotals(
    [
      { id: "h", status: "held", commission_amount: "12.50" },
      { id: "p", status: "paid", commission_amount: 80 },
      { id: "r", status: "payout_requested", commission_amount: 20 },
      { id: "a", status: "available", commission_amount: 10 },
      { id: "x", status: "something_else", commission_amount: 999 },
    ],
    [],
  );
  assert.deepEqual(totals, { held: 12.5, available: 10, payout_requested: 20, paid: 80 });
});

test("commission totals: earned minus paid minus reserved always adds up, and nothing goes negative", () => {
  const commissions = [
    { id: "a", status: "available", commission_amount: 33.33 },
    { id: "b", status: "paid", commission_amount: 66.67 },
  ];
  const allocations = [
    { commission_id: "a", amount: 40, status: "paid" }, // more than the commission (bad data): clamped at 0 due
    { commission_id: "b", amount: 66.67, status: "paid" },
  ];
  const totals = commissionTotals(commissions, allocations);
  assert.equal(totals.available, 0);
  assert.equal(totals.paid, 106.67);
  assert.ok(Object.values(totals).every((v) => v >= 0));
  assert.deepEqual(commissionTotals([], []), { held: 0, available: 0, payout_requested: 0, paid: 0 });
});
