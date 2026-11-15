/** Commission totals for the admin screens (pure, no imports: unit-tested). */

export type CommissionRow = { id: string; status: string; commission_amount: number | string | null };
export type AllocationRow = { commission_id: string; amount: number | string | null; status: string };

export type CommissionTotals = {
  /** Waiting for the workshop to settle its debt. */
  held: number;
  /** Net payable now: earned (not held) minus what was paid minus what is reserved by a pending payout request. */
  available: number;
  /** Reserved by a payout request that is still being reviewed. */
  payout_requested: number;
  /** Already paid out (partial payouts count by the amount paid, not only fully paid commissions). */
  paid: number;
};

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const cents = (value: number): number => Math.round(value * 100) / 100;

/**
 * Same rules as the marketer's own dashboard (app/api/marketer/dashboard), so both sides show the same numbers:
 * a payout is allocated per commission (paid / pending / released), so a commission can be partly paid and still
 * "available". Summing `commission_amount` by status therefore counted the already-paid part as still due.
 * Commissions from before allocations existed (no allocation rows) count fully as paid / requested by their status.
 */
export function commissionTotals(commissions: CommissionRow[], allocations: AllocationRow[]): CommissionTotals {
  const byCommission = new Map<string, { pending: number; paid: number }>();
  for (const a of allocations) {
    const item = byCommission.get(a.commission_id) ?? { pending: 0, paid: 0 };
    if (a.status === "pending") item.pending += num(a.amount);
    if (a.status === "paid") item.paid += num(a.amount);
    byCommission.set(a.commission_id, item);
  }
  const totals: CommissionTotals = { held: 0, available: 0, payout_requested: 0, paid: 0 };
  for (const row of commissions) {
    const amount = num(row.commission_amount);
    if (row.status === "held") {
      totals.held += amount;
      continue;
    }
    if (row.status !== "available" && row.status !== "payout_requested" && row.status !== "paid") continue;
    const alloc = byCommission.get(row.id) ?? { pending: 0, paid: 0 };
    const noAllocations = alloc.paid === 0 && alloc.pending === 0;
    const legacyPaid = row.status === "paid" && noAllocations ? amount : 0;
    const legacyRequested = row.status === "payout_requested" && noAllocations ? amount : 0;
    totals.paid += alloc.paid + legacyPaid;
    totals.payout_requested += alloc.pending + legacyRequested;
    totals.available += Math.max(0, amount - alloc.paid - alloc.pending - legacyPaid - legacyRequested);
  }
  return {
    held: cents(totals.held),
    available: cents(totals.available),
    payout_requested: cents(totals.payout_requested),
    paid: cents(totals.paid),
  };
}
