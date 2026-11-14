/** Pure decision rules for receipt reuse (no imports, so they can be unit-tested). */

export type ReceiptClaimRow = { order_id: string | null; locked_at: string | null; created_at: string };

/** A claim that never got an order attached (the request crashed or is still running) is stale after this long. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * What to do when a receipt's fingerprint is already stored:
 *  - "blocked":     the receipt belongs to an order, whatever that order's status is (pending, approved, shipped,
 *                   delivered or cancelled), or another request is still creating its order. A cancelled order does NOT
 *                   free its receipt: the same transfer image can never back a second order.
 *  - "stale_claim": an old claim that never got an order (a crashed request); the only case where it is taken over.
 */
export function receiptDecision(row: ReceiptClaimRow, nowMs: number): "blocked" | "stale_claim" {
  if (row.locked_at || row.order_id) return "blocked";
  return nowMs - new Date(row.created_at).getTime() > STALE_CLAIM_MS ? "stale_claim" : "blocked";
}
