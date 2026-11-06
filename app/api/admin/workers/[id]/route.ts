import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  if (!isUuid(id)) return fail("معرّف الموظف غير صالح");
  const body = await readJson(req);
  if (!body || typeof body.is_active !== "boolean") return fail("حالة الحساب غير صالحة");

  const { data, error } = await getSupabaseAdmin().from("users")
    .update({ is_active: body.is_active })
    .eq("id", id).eq("role", "worker").is("deleted_at", null)
    .select("id, name, phone, is_active, created_at").maybeSingle();
  if (error) return dbFail("worker update", error, "تعذر تحديث حساب الموظف");
  if (!data) return fail("حساب الموظف غير موجود", 404);
  return ok({ worker: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  if (!isUuid(id)) return fail("معرّف الموظف غير صالح");

  const db = getSupabaseAdmin();
  const { data: worker, error: lookupError } = await db.from("users")
    .select("id, is_active, deleted_at")
    .eq("id", id).eq("role", "worker").maybeSingle();
  if (lookupError) return dbFail("worker delete lookup", lookupError, "تعذر التحقق من حساب الموظف");
  if (!worker || worker.deleted_at) return fail("حساب الموظف غير موجود", 404);
  if (worker.is_active) return fail("يجب إيقاف حساب الموظف قبل حذفه", 409);

  const { data, error } = await db.from("users")
    .update({ deleted_at: new Date().toISOString(), deleted_by: guard.admin.id, is_active: false })
    .eq("id", id).eq("role", "worker").eq("is_active", false).is("deleted_at", null)
    .select("id").maybeSingle();
  if (error) return dbFail("worker soft delete", error, "تعذر حذف حساب الموظف");
  if (!data) return fail("تعذر حذف الحساب؛ ربما تم تغييره من مدير آخر", 409);
  return ok({ deleted: true });
}
