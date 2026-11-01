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
  const { data: target, error: findError } = await db.from("users").select("id, role, is_active, rejected_at").eq("id", params.id).maybeSingle();
  if (findError) return dbFail("account lookup", findError);
  if (!target) return fail("الحساب غير موجود", 404);
  if (target.role !== "workshop" && target.role !== "marketer") return fail("لا يمكن تعديل حسابات الإدارة من هنا", 403);

  const updates: Record<string, unknown> = {};
  const rejecting = body.reject === true;
  if (rejecting) {
    if (target.role !== "workshop" || target.is_active) return fail("يمكن رفض طلب ورشة بانتظار التفعيل فقط");
    if (target.rejected_at) return fail("تم رفض طلب هذه الورشة مسبقاً");
    updates.is_active = false;
    updates.rejected_at = new Date().toISOString();
  }

  if ("is_active" in body) {
    if (typeof body.is_active !== "boolean") return fail("قيمة التفعيل غير صالحة");
    updates.is_active = body.is_active;
    if (body.is_active === true && target.rejected_at) updates.rejected_at = null;
  }
  if ("debt_limit" in body) {
    if (target.role !== "workshop") return fail("سقف الدين خاص بالورشات فقط");
    const limit = Number(body.debt_limit);
    if (!Number.isFinite(limit) || limit < 0 || limit > 1_000_000_000) return fail("سقف الدين غير صالح");
    updates.debt_limit = Math.round(limit * 100) / 100;
  }
  if (!Object.keys(updates).length) return fail("لا توجد تغييرات للحفظ");

  const { data, error } = await db.from("users").update(updates).eq("id", target.id).select("id, is_active, debt_limit, tier").single();
  if (error) return dbFail("account update", error, "تعذر حفظ التعديلات");
  if (rejecting) {
    await notifyUser({
      userId: String(target.id),
      type: "account_rejected",
      title: "رفض الحساب",
      body: "نعتذر، لم تتم الموافقة على حسابك",
      eventKey: `account:${target.id}:rejected:${String(updates.rejected_at)}`,
      data: { screen: "account" },
    });
  } else if (typeof updates.is_active === "boolean" && target.is_active !== updates.is_active) {
    const accepted = updates.is_active;
    await notifyUser({
      userId: String(target.id),
      type: accepted ? "account_approved" : "account_status",
      title: accepted ? "تم قبول الحساب" : "تحديث حالة الحساب",
      body: accepted
        ? (target.role === "workshop" ? "تم قبول حساب ورشتك، يمكنك البدء بالشراء" : "تم تفعيل حسابك كمسوق")
        : "تم إيقاف حسابك من قبل الإدارة",
      eventKey: `account:${target.id}:${accepted ? "approved" : "disabled"}:${new Date().toISOString()}`,
      data: { screen: "account" },
    });
  }
  return ok({ account: data });
}
