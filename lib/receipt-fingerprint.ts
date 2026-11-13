import { getSupabaseAdmin } from "@/lib/supabase";
import { receiptDecision } from "@/lib/receipt-rules";

/**
 * One receipt image, one order. The SHA-256 of the uploaded bytes is stored in public.receipt_fingerprints (unique), so
 * the same Sham Cash transfer screenshot cannot back two orders - not from parallel requests (the insert itself is the
 * lock) and not after an order was approved (a database trigger locks the fingerprint at approval).
 * Reuse is allowed only when the earlier order was cancelled/rejected and was never approved; every decision is logged
 * in receipt_fingerprint_events. A re-encoded screenshot has different bytes and is not detected (documented limit).
 */

type PgError = { code?: string } | null | undefined;
const missing = (err: PgError) => err?.code === "42P01" || err?.code === "PGRST205";

export type ReceiptClaim =
  | { ok: true; tracked: boolean }
  | { ok: false; status: number; message: string };

async function logEvent(fingerprint: string, userId: string, event: string, orderId: string | null, detail: Record<string, unknown> = {}) {
  const { error } = await getSupabaseAdmin().from("receipt_fingerprint_events")
    .insert({ fingerprint, user_id: userId, order_id: orderId, event, detail });
  if (error) console.error("[receipt] event log:", error.code);
}

export async function claimReceipt(fingerprint: string, userId: string): Promise<ReceiptClaim> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("receipt_fingerprints").insert({ fingerprint, user_id: userId });
  if (!error) return { ok: true, tracked: true };
  if (missing(error)) {
    // The migration is not applied yet: orders keep working, but reuse is not blocked. Logged loudly.
    console.error("[receipt] receipt_fingerprints table is missing: apply the receipt fingerprint migration to block reused receipts");
    return { ok: true, tracked: false };
  }
  if (error.code !== "23505") {
    console.error("[receipt] claim:", error);
    return { ok: false, status: 503, message: "تعذر التحقق من إشعار التحويل حالياً، حاول لاحقاً" };
  }

  const { data: row, error: readError } = await db.from("receipt_fingerprints")
    .select("order_id, locked_at, created_at").eq("fingerprint", fingerprint).maybeSingle();
  if (readError || !row) {
    // The row vanished between the insert and the read (released by its owner): ask the customer to retry.
    return { ok: false, status: 409, message: "تعذر التحقق من إشعار التحويل، أعد المحاولة" };
  }
  let orderStatus: string | null = null;
  if (row.order_id) {
    const { data: order } = await db.from("orders").select("status").eq("id", row.order_id).maybeSingle();
    orderStatus = order?.status ?? null;
  }
  const decision = receiptDecision(
    { order_id: row.order_id ? String(row.order_id) : null, locked_at: row.locked_at ?? null, created_at: String(row.created_at) },
    orderStatus, Date.now(),
  );
  if (decision === "blocked") {
    await logEvent(fingerprint, userId, "blocked_duplicate", row.order_id ? String(row.order_id) : null);
    return { ok: false, status: 409, message: "إشعار التحويل هذا مستخدم في طلب آخر. أرفق إشعار تحويل جديداً." };
  }

  // Take the fingerprint over; the compare-and-set on order_id / locked_at makes parallel takeovers safe.
  let takeover = db.from("receipt_fingerprints")
    .update({ user_id: userId, order_id: null, created_at: new Date().toISOString() })
    .eq("fingerprint", fingerprint).is("locked_at", null);
  takeover = row.order_id ? takeover.eq("order_id", row.order_id) : takeover.is("order_id", null);
  const { data: taken, error: takeError } = await takeover.select("fingerprint").maybeSingle();
  if (takeError || !taken) return { ok: false, status: 409, message: "إشعار التحويل هذا مستخدم في طلب آخر. أرفق إشعار تحويل جديداً." };
  await logEvent(fingerprint, userId, decision === "reuse" ? "reused_after_cancel" : "stale_claim_taken",
    row.order_id ? String(row.order_id) : null);
  return { ok: true, tracked: true };
}

/** Ties the fingerprint to the order that was just created. */
export async function attachReceipt(fingerprint: string, userId: string, orderId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("receipt_fingerprints")
    .update({ order_id: orderId }).eq("fingerprint", fingerprint).eq("user_id", userId).is("order_id", null);
  if (error) console.error("[receipt] attach:", error.code);
  else await logEvent(fingerprint, userId, "claimed", orderId);
}

/** Gives the fingerprint back when no order was created (a claim without an order is never kept). */
export async function releaseReceipt(fingerprint: string, userId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("receipt_fingerprints")
    .delete().eq("fingerprint", fingerprint).eq("user_id", userId).is("order_id", null);
  if (error && !missing(error)) console.error("[receipt] release:", error.code);
}
