/** Pure decision rules for receipt reuse (no imports, so they can be unit-tested). */

export type ReceiptClaimRow = { order_id: string | null; locked_at: string | null; created_at: string };

/** A claim that never got an order attached (the request crashed or is still running) is stale after this long. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * What to do when a receipt's fingerprint is already stored:
 *  - "blocked":     the earlier order is still alive, was approved (locked), or another request is still creating it
 *  - "reuse":       the earlier order was cancelled/rejected for good and was never approved, so the customer may
 *                   attach the same receipt to a new order (the reuse is logged)
 *  - "stale_claim": an old claim without an order; it is taken over
 */
export function receiptDecision(row: ReceiptClaimRow, orderStatus: string | null, nowMs: number): "blocked" | "reuse" | "stale_claim" {
  if (row.locked_at) return "blocked";
  if (!row.order_id) {
    return nowMs - new Date(row.created_at).getTime() > STALE_CLAIM_MS ? "stale_claim" : "blocked";
  }
  return orderStatus === "cancelled" ? "reuse" : "blocked";
}
