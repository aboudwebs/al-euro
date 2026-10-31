import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Workshop tiers are calculated by delivered purchases; admins can change activation and debt limit only. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return fail("معرّف الحساب غير صالح");

  const body = await readJson(req);
  if (!body) return fail("بيانات غير صالحة");

  const db = getSupabaseAdmin();
  const { data: target, error: findError } = await db.from("users").select("id, role").eq("id", params.id).maybeSingle();
  if (findError) return dbFail("account lookup", findError);
  if (!target) return fail("الحساب غير موجود", 404);
  if (target.role !== "workshop" && target.role !== "marketer") return fail("لا يمكن تعديل حسابات الإدارة من هنا", 403);

  const updates: Record<string, unknown> = {};

  if ("is_active" in body) {
    if (typeof body.is_active !== "boolean") return fail("قيمة التفعيل غير صالحة");
    updates.is_active = body.is_active;
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
  return ok({ account: data });
}
