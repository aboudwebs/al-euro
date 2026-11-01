import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return fail("معرّف الطلب غير صالح");

  const body = await readJson(req);
  const status = body?.status;
  if (status !== "refunded" && status !== "not_refundable") {
    return fail("حالة الاسترداد غير صالحة");
  }
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;
  if (status === "not_refundable" && (!note || note.length < 3)) {
    return fail("يرجى توضيح سبب عدم الاسترداد");
  }

  const { data, error } = await getSupabaseAdmin().rpc("admin_update_sham_refund_status", {
    p_order_id: params.id,
    p_new_status: status,
    p_note: note,
    p_actor_id: guard.admin.id,
  });
  if (error) return dbFail("Sham Cash refund update", error, "تعذر تحديث حالة الاسترداد");
  return ok({ result: data });
}
