import { requireStaffAccess } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ORDER_STATUS } from "@/lib/status";

export const dynamic = "force-dynamic";

/**
 * Body: { tracking: string }  - the shipment tracking number shown to the customer in the app ("" clears it).
 * Needs the orders.tracking_number column from supabase/updates_2026_10.sql.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStaffAccess("orders");
  if (!guard.ok) return guard.response;
  if (!isUuid(id)) return fail("معرّف الطلب غير صالح");

  const body = await readJson(req);
  if (!body || typeof body.tracking !== "string") return fail("رقم التتبع غير صالح");
  const tracking = body.tracking.trim().replace(/\s+/g, " ");
  if (tracking.length > 60) return fail("رقم التتبع طويل جداً (الحد 60 حرفاً)");

  const db = getSupabaseAdmin();
  const { data: order, error: readError } = await db.from("orders").select("id, status, claimed_by").eq("id", id).maybeSingle();
  if (readError) return dbFail("tracking read", readError);
  if (!order) return fail("الطلب غير موجود", 404);
  if (order.status === ORDER_STATUS.cancelled) return fail("لا يمكن إضافة رقم تتبع لطلب ملغي");
  if (guard.admin.role === "worker" && order.claimed_by !== guard.admin.id) {
    return fail("لا يمكنك تعديل تتبع طلب استلمه موظف آخر", 403);
  }

  let update = db.from("orders").update({ tracking_number: tracking || null }).eq("id", id);
  if (guard.admin.role === "worker") update = update.eq("claimed_by", guard.admin.id);
  const { data: updated, error } = await update.select("id").maybeSingle();
  if (!error && !updated) return fail("لم تعد تملك الطلبية أو تم تغيير المسؤول عنها", 403);
  if (error?.code === "42703") return fail("عمود رقم التتبع غير موجود: شغّل ملف supabase/updates_2026_10.sql في Supabase", 500);
  if (error) return dbFail("tracking update", error, "تعذر حفظ رقم التتبع");
  return ok({ tracking: tracking || null });
}
