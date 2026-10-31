import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { parsePart } from "@/lib/admin-parts";

export const dynamic = "force-dynamic";

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  if (!SAFE_ID.test(params.id)) return fail("معرّف القطعة غير صالح");

  const body = await readJson(req);
  if (!body) return fail("بيانات غير صالحة");
  const parsed = parsePart(body, true);
  if (!parsed.ok) return fail(parsed.error);
  if (!Object.keys(parsed.value).length) return fail("لا توجد تغييرات للحفظ");

  const { data, error } = await getSupabaseAdmin()
    .from("parts")
    .update(parsed.value)
    .eq("id", params.id)
    .select("id, name, brand, model, years, oem_number, alt_grade, price, stock, branch, image_url, is_active, created_at")
    .maybeSingle();
  if (error) return dbFail("parts update", error, "تعذر حفظ القطعة");
  if (!data) return fail("القطعة غير موجودة", 404);
  return ok({ part: data });
}
