import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { dbError, readBody, reply, requireUser } from "@/lib/account-api";
import { parseVehicle, vehicleJson, type VehicleRow } from "@/lib/account-data";

export const dynamic = "force-dynamic";

const MAX_VEHICLES = 30;
const FIELDS = "id, name, vin, make, model, year, notes";

/** The signed-in customer's registered vehicles. Only rows of this user are ever returned. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data, error } = await getSupabaseAdmin()
    .from("user_vehicles")
    .select(FIELDS)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: true })
    .limit(MAX_VEHICLES + 5);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return reply({ vehicles: [], ready: false });
    return dbError("vehicles list", error, "تعذر تحميل المركبات");
  }
  return reply({ vehicles: (data ?? []).map((r) => vehicleJson(r as VehicleRow)), ready: true });
}

/** Body: { vin, name?, make?, model?, year?, notes? } */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  if (!body) return reply({ error: "بيانات الطلب غير صالحة" }, 400);
  const parsed = parseVehicle(body, false);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return reply({ error: "مفتاح التأكيد غير صالح" }, 400);
  }
  const requestHash = createHash("sha256").update(JSON.stringify(parsed.value)).digest("hex");

  const db = getSupabaseAdmin();
  const { data: previous, error: previousError } = await db.from("user_vehicles")
    .select("id, request_hash").eq("user_id", auth.user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (previousError) return dbError("vehicle idempotency", previousError, "تعذر التحقق من الطلب السابق");
  if (previous) {
    if (previous.request_hash !== requestHash) return reply({ error: "مفتاح التأكيد مستخدم لمركبة مختلفة" }, 409);
    const { data: existing } = await db.from("user_vehicles").select(FIELDS).eq("id", previous.id).single();
    return reply({ ok: true, vehicle: existing ? vehicleJson(existing as VehicleRow) : null, duplicate: true });
  }
  const { count, error: countError } = await db.from("user_vehicles").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id);
  if (countError) return dbError("vehicles count", countError, "تعذر حفظ المركبة");
  if ((count ?? 0) >= MAX_VEHICLES) return reply({ error: `الحد الأقصى ${MAX_VEHICLES} مركبة، احذف مركبة قبل إضافة أخرى` }, 400);

  const { data, error } = await db
    .from("user_vehicles")
    .insert({ ...parsed.value, user_id: auth.user.id, idempotency_key: idempotencyKey, request_hash: requestHash })
    .select(FIELDS)
    .single();
  if (error?.code === "23505") {
    const { data: duplicate } = await db.from("user_vehicles").select("id, request_hash").eq("user_id", auth.user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (duplicate?.request_hash === requestHash) {
      const { data: existing } = await db.from("user_vehicles").select(FIELDS).eq("id", duplicate.id).single();
      return reply({ ok: true, vehicle: existing ? vehicleJson(existing as VehicleRow) : null, duplicate: true });
    }
    return reply({ error: "هذه المركبة (نفس رقم الشاصي) مسجلة مسبقاً أو تم استقبال التأكيد" }, 409);
  }
  if (error || !data) return dbError("vehicle insert", error, "تعذر حفظ المركبة");
  return reply({ ok: true, vehicle: vehicleJson(data as VehicleRow) }, 201);
}
