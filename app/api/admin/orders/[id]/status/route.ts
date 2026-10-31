import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ORDER_STATUS, ORDER_STATUSES, ORDER_TRANSITIONS, type OrderStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

/**
 * Body: { status: "approved"|"shipped"|"delivered"|"cancelled", note?: string }
 * All side effects (stock, debt, ledger, commission) happen inside the admin_set_order_status SQL function
 * in a single transaction. A cancellation requires a reason: it is saved in orders.status_note and shown to the customer.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return fail("معرّف الطلب غير صالح");

  const body = await readJson(req);
  const status = body?.status;
  if (typeof status !== "string" || !(ORDER_STATUSES as string[]).includes(status) || status === ORDER_STATUS.pending) {
    return fail("الحالة المطلوبة غير صالحة");
  }
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (status === ORDER_STATUS.cancelled && note.length < 3) return fail("يرجى كتابة سبب الإلغاء/الرفض ليظهر للعميل");

  const db = getSupabaseAdmin();
  const { data: current, error: readError } = await db.from("orders").select("status").eq("id", params.id).maybeSingle();
  if (readError) return dbFail("order status read", readError);
  if (!current) return fail("الطلب غير موجود", 404);
  if (!ORDER_TRANSITIONS[current.status as OrderStatus]?.includes(status as OrderStatus)) {
    return fail("لا يمكن نقل الطلب إلى هذه الحالة من حالته الحالية");
  }

  const { data, error } = await db.rpc("admin_set_order_status", {
    p_order_id: params.id,
    p_new_status: status,
    p_note: note || null,
  });
  if (error) return dbFail("order status rpc", error, "تعذر تحديث حالة الطلب");
  return ok({ result: data });
}
