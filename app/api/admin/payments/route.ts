import { requireAdmin } from "@/lib/admin-guard";
import { clampLimit, dbFail, ok, signStored } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ORDER_STATUSES } from "@/lib/status";

export const dynamic = "force-dynamic";

/** Sham Cash queue: orders with pay_method = 'sham'. ?status=pending (default) | approved | cancelled | all */
export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";

  const db = getSupabaseAdmin();
  let query = db.from("orders").select("*").eq("pay_method", "sham");
  if (status !== "all" && (ORDER_STATUSES as string[]).includes(status)) query = query.eq("status", status);
  const { data, error } = await query
    .order("created_at", { ascending: status === "pending" })
    .limit(clampLimit(url.searchParams.get("limit"), 100, 300));
  if (error) return dbFail("payments list", error, "تعذر تحميل الدفعات");

  const userIds = Array.from(new Set((data ?? []).map((o) => o.user_id).filter(Boolean)));
  const users: Record<string, unknown> = {};
  if (userIds.length) {
    const { data: rows } = await db.from("users").select("id, name, phone, role, city, license, tier").in("id", userIds);
    for (const u of rows ?? []) users[String(u.id)] = u;
  }
  const signed = await signStored("receipts", (data ?? []).map((o) => o.receipt_url));

  const payments = (data ?? []).map(({ receipt_url, ...o }) => ({
    ...o,
    receipt_signed_url: receipt_url ? signed[receipt_url] ?? null : null,
    account: users[String(o.user_id)] ?? null,
  }));
  return ok({ payments });
}
