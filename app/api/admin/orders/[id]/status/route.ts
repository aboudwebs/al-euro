import { requireStaffAccess } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ORDER_STATUS, ORDER_STATUSES } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireStaffAccess("orders");
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return fail("معرّف الطلب غير صالح");

  const body = await readJson(req);
  const status = body?.status;
  if (typeof status !== "string" || !(ORDER_STATUSES as string[]).includes(status) || status === ORDER_STATUS.pending) {
    return fail("الحالة المطلوبة غير صالحة");
  }
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (guard.admin.role === "worker" && status === ORDER_STATUS.cancelled) return fail("لا تملك صلاحية إلغاء الطلبات", 403);
  if (status === ORDER_STATUS.cancelled && note.length < 3) return fail("يرجى كتابة سبب الإلغاء/الرفض ليظهر للعميل");

  const { data, error } = await getSupabaseAdmin().rpc("admin_set_order_status_for_staff", {
    p_order_id: params.id,
    p_new_status: status,
    p_note: note || null,
    p_actor_id: guard.admin.id,
  });
  if (error) return dbFail("order status rpc", error, "تعذر تحديث حالة الطلب");
  return ok({ result: data });
}
