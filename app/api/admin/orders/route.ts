import { requireAdmin } from "@/lib/admin-guard";
import { clampLimit, cleanSearch, dbFail, ok } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ORDER_STATUSES, PAY_METHOD } from "@/lib/status";

export const dynamic = "force-dynamic";

/** ?status=  ?pay=sham|cod|debt  ?q=order-number-or-name-or-phone  ?limit= */
export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const pay = url.searchParams.get("pay");
  const q = cleanSearch(url.searchParams.get("q"));

  let query = getSupabaseAdmin()
    .from("orders")
    .select("id, order_number, user_id, customer_name, customer_phone, user_role, items, total_amount, pay_method, receipt_url, status, status_note, created_at");
  if (status && (ORDER_STATUSES as string[]).includes(status)) query = query.eq("status", status);
  if (pay && (Object.values(PAY_METHOD) as string[]).includes(pay)) query = query.eq("pay_method", pay);
  if (q) {
    const parts = [`customer_name.ilike.*${q}*`, `customer_phone.ilike.*${q}*`];
    if (/^\d{1,9}$/.test(q)) parts.push(`order_number.eq.${Number(q)}`);
    query = query.or(parts.join(","));
  }
  const { data, error } = await query.order("created_at", { ascending: false }).limit(clampLimit(url.searchParams.get("limit")));
  if (error) return dbFail("orders list", error, "تعذر تحميل الطلبات");

  const orders = (data ?? []).map(({ receipt_url, ...rest }) => ({ ...rest, has_receipt: !!receipt_url }));
  return ok({ orders });
}
