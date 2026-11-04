import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyUser } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Workshop tiers are calculated by delivered purchases; admins can change activation and debt limit only. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return fail("معرّف الحساب غير صالح");

  const body = await readJson(req);
  if (!body) return fail("بيانات غير صالحة");

  const db = getSupabaseAdmin();
  const { data: target, error: findError } = await db.from("users").select("id, role, is_active, license, license_verification_status").eq("id", params.id).maybeSingle();
  if (findError) return dbFail("account lookup", findError);
  if (!target) return fail("الحساب غير موجود", 404);
  if (target.role !== "workshop" && target.role !== "marketer") return fail("لا يمكن تعديل حسابات الإدارة من هنا", 403);

  const updates: Record<string, unknown> = {};

  if ("is_active" in body) {
    if (typeof body.is_active !== "boolean") return fail("قيمة التفعيل غير صالحة");
    if (body.is_active && target.role === "workshop" && !target.license && body.license_verification_status !== "verified" && target.license_verification_status !== "verified") {
      return fail("يجب إكمال التحقق اليدوي من هوية الورشة قبل تفعيل الحساب", 403);
    }
    updates.is_active = body.is_active;
  }
  if ("license_verification_status" in body) {
    if (target.role !== "workshop" || target.license) return fail("التحقق اليدوي متاح للورشات التي لا تملك ترخيصاً فقط", 400);
    const status = body.license_verification_status;
    if (!["pending", "verified", "rejected"].includes(String(status))) return fail("حالة التحقق غير صالحة");
    const workshopName = typeof body.license_verification_workshop_name === "string" ? body.license_verification_workshop_name.trim().slice(0, 120) : "";
    const address = typeof body.license_verification_address === "string" ? body.license_verification_address.trim().slice(0, 240) : "";
    const evidence = typeof body.license_verification_evidence === "string" ? body.license_verification_evidence.trim().slice(0, 1000) : "";
    const notes = typeof body.license_verification_notes === "string" ? body.license_verification_notes.trim().slice(0, 1000) : "";
    if (status === "verified" && (!workshopName || !address || !evidence)) {
      return fail("للتأكيد يجب تسجيل اسم الورشة وعنوانها ووصف أدلة التحقق");
    }
    if (status === "rejected" && !notes) return fail("يرجى تسجيل سبب تعذر التحقق");
    updates.license_verification_status = status;
    updates.license_verification_workshop_name = workshopName || null;
    updates.license_verification_address = address || null;
    updates.license_verification_evidence = evidence || null;
    updates.license_verification_notes = notes || null;
    updates.license_verification_reviewed_at = status === "pending" ? null : new Date().toISOString();
    updates.license_verification_reviewed_by = status === "pending" ? null : guard.admin.id;
    if (status === "verified") updates.is_active = true;
    if (status === "rejected") updates.is_active = false;
  }
  if ("debt_limit" in body) {
    if (target.role !== "workshop") return fail("سقف الدين خاص بالورشات فقط");
    const limit = Number(body.debt_limit);
    if (!Number.isFinite(limit) || limit < 0 || limit > 1_000_000_000) return fail("سقف الدين غير صالح");
    updates.debt_limit = Math.round(limit * 100) / 100;
  }
  if (!Object.keys(updates).length) return fail("لا توجد تغييرات للحفظ");

  const { data, error } = await db.from("users").update(updates).eq("id", target.id).select("id, is_active, debt_limit, tier, license_verification_status, license_verification_reviewed_at").single();
  if (error) return dbFail("account update", error, "تعذر حفظ التعديلات");
  if (typeof updates.is_active === "boolean" && target.is_active !== updates.is_active) {
    const accepted = updates.is_active;
    const roleLabel = target.role === "workshop" ? "حساب ورشتك" : "حسابك كمسوق";
    await notifyUser({
      userId: String(target.id),
      type: accepted ? "account_approved" : "account_status",
      title: accepted ? "تم قبول الحساب" : "تحديث حالة الحساب",
      body: accepted
        ? (target.role === "workshop" ? "تم قبول حساب ورشتك، يمكنك البدء بالشراء" : "تم تفعيل حسابك كمسوق")
        : "نعتذر، لم تتم الموافقة على حسابك",
      eventKey: `account:${target.id}:${accepted ? "approved" : "disabled"}:${new Date().toISOString()}`,
      data: { screen: "account" },
    });
  }
  return ok({ account: data });
}
