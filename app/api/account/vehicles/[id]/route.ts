import { getSupabaseAdmin } from "@/lib/supabase";
import { dbError, isUuid, readBody, reply, requireUser } from "@/lib/account-api";
import { parseVehicle, vehicleJson, type VehicleRow } from "@/lib/account-data";

export const dynamic = "force-dynamic";

const FIELDS = "id, name, vin, make, model, year, notes";

/** Body: any of { vin, name, make, model, year, notes }. Every query is limited to the signed-in user's own rows. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!isUuid(params.id)) return reply({ error: "معرّف المركبة غير صالح" }, 400);
  const body = await readBody(req);
  if (!body) return reply({ error: "بيانات الطلب غير صالحة" }, 400);
  const parsed = parseVehicle(body, true);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);
  if (!Object.keys(parsed.value).length) return reply({ error: "لا توجد تغييرات للحفظ" }, 400);

  const { data, error } = await getSupabaseAdmin()
    .from("user_vehicles")
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("user_id", auth.user.id)
    .select(FIELDS)
    .maybeSingle();
  if (error?.code === "23505") return reply({ error: "هذه المركبة (نفس رقم الشاصي) مسجلة مسبقاً" }, 409);
  if (error) return dbError("vehicle update", error, "تعذر حفظ المركبة");
  if (!data) return reply({ error: "المركبة غير موجودة" }, 404);
  return reply({ ok: true, vehicle: vehicleJson(data as VehicleRow) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!isUuid(params.id)) return reply({ error: "معرّف المركبة غير صالح" }, 400);

  const { data, error } = await getSupabaseAdmin()
    .from("user_vehicles")
    .delete()
    .eq("id", params.id)
    .eq("user_id", auth.user.id)
    .select("id")
    .maybeSingle();
  if (error) return dbError("vehicle delete", error, "تعذر حذف المركبة");
  if (!data) return reply({ error: "المركبة غير موجودة" }, 404);
  return reply({ ok: true });
}
