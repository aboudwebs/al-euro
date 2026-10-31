import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return fail("معرّف الموظف غير صالح");
  const body = await readJson(req);
  if (!body || typeof body.is_active !== "boolean") return fail("حالة الحساب غير صالحة");

  const { data, error } = await getSupabaseAdmin().from("users")
    .update({ is_active: body.is_active })
    .eq("id", params.id).eq("role", "worker")
    .select("id, name, phone, is_active, created_at").maybeSingle();
  if (error) return dbFail("worker update", error, "تعذر تحديث حساب الموظف");
  if (!data) return fail("حساب الموظف غير موجود", 404);
  return ok({ worker: data });
}
