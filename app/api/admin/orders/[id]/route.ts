import { requireStaffAccess } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok, signStored } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** One order with its customer, signed receipt URL, ledger rows and commission (for the drawer and the invoice). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireStaffAccess("orders");
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return fail("معرّف الطلب غير صالح");

  const isWorker = guard.admin.role === "worker";
  const db = getSupabaseAdmin();
  const { data: order, error } = await db.from("orders").select("*").eq("id", params.id).maybeSingle();
  if (error) return dbFail("order detail", error, "تعذر تحميل الطلب");
  if (!order) return fail("الطلب غير موجود", 404);

  const [{ data: customer }, { data: ledger }, { data: commission }, signed] = await Promise.all([
    db.from("users").select("id, name, phone, role, city, license, tier, debt_limit, debt_balance, referred_by_code").eq("id", order.user_id).maybeSingle(),
    db.from("debt_ledger").select("id, tx_type, amount, balance_after, note, created_at").eq("order_id", order.id).order("created_at", { ascending: true }),
    db.from("marketer_commissions").select("id, commission_amount, status, marketer_id").eq("order_id", order.id).maybeSingle(),
    signStored("receipts", [order.receipt_url]),
  ]);

  const { receipt_url, ...rest } = order;
  return ok({
    order: { ...rest, receipt_signed_url: receipt_url ? signed[receipt_url] ?? null : null },
    customer: customer ? (isWorker
      ? { id: customer.id, name: customer.name, phone: customer.phone, role: customer.role, city: customer.city, license: customer.license }
      : customer) : null,
    ledger: isWorker ? [] : ledger ?? [],
    commission: isWorker ? null : commission ?? null,
  });
}
