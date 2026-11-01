import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { dbError, readBody, reply, requireUser } from "@/lib/account-api";
import { addressJson, parseAddress, type AddressRow } from "@/lib/account-data";

export const dynamic = "force-dynamic";

const MAX_ADDRESSES = 10;
const FIELDS = "id, label, governorate, area, street, details, phone, is_default, created_at";

/** The signed-in customer's saved addresses (default first). */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data, error } = await getSupabaseAdmin()
    .from("user_addresses")
    .select(FIELDS)
    .eq("user_id", auth.user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(MAX_ADDRESSES + 5);
  if (error) {
    // Before the SQL update the list is simply empty, so the rest of the app keeps working.
    if (error.code === "42P01" || error.code === "PGRST205") return reply({ addresses: [], ready: false });
    return dbError("addresses list", error, "تعذر تحميل العناوين");
  }
  return reply({ addresses: (data ?? []).map((r) => addressJson(r as AddressRow)), ready: true });
}

/** Body: { label, governorate?, area?, street?, details?, phone?, isDefault? } */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  if (!body) return reply({ error: "بيانات الطلب غير صالحة" }, 400);
  const parsed = parseAddress(body, false);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return reply({ error: "مفتاح التأكيد غير صالح" }, 400);
  }
  const requestHash = createHash("sha256").update(JSON.stringify({ ...parsed.value, isDefault: body.isDefault === true })).digest("hex");

  const db = getSupabaseAdmin();
  const { data: previous, error: previousError } = await db.from("user_addresses")
    .select("id, request_hash").eq("user_id", auth.user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (previousError) return dbError("address idempotency", previousError, "تعذر التحقق من الطلب السابق");
  if (previous) {
    if (previous.request_hash !== requestHash) return reply({ error: "مفتاح التأكيد مستخدم لعنوان مختلف" }, 409);
    const { data: existing } = await db.from("user_addresses").select(FIELDS).eq("id", previous.id).single();
    return reply({ ok: true, address: existing ? addressJson(existing as AddressRow) : null, duplicate: true });
  }
  const { count, error: countError } = await db.from("user_addresses").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id);
  if (countError) return dbError("addresses count", countError, "تعذر حفظ العنوان");
  if ((count ?? 0) >= MAX_ADDRESSES) return reply({ error: `الحد الأقصى ${MAX_ADDRESSES} عناوين، احذف عنواناً قبل إضافة آخر` }, 400);

  const makeDefault = body.isDefault === true || (count ?? 0) === 0;
  const { data, error } = await db
    .from("user_addresses")
    .insert({ ...parsed.value, user_id: auth.user.id, is_default: makeDefault, idempotency_key: idempotencyKey, request_hash: requestHash })
    .select(FIELDS)
    .single();
  if (error?.code === "23505") {
    const { data: duplicate } = await db.from("user_addresses").select("id, request_hash").eq("user_id", auth.user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (duplicate?.request_hash === requestHash) {
      const { data: existing } = await db.from("user_addresses").select(FIELDS).eq("id", duplicate.id).single();
      return reply({ ok: true, address: existing ? addressJson(existing as AddressRow) : null, duplicate: true });
    }
    return reply({ error: "تم استقبال محاولة التأكيد مسبقاً. حدّث قائمة العناوين للتحقق" }, 409);
  }
  if (error || !data) return dbError("address insert", error, "تعذر حفظ العنوان");

  if (makeDefault) {
    await db.from("user_addresses").update({ is_default: false }).eq("user_id", auth.user.id).neq("id", data.id);
  }
  return reply({ ok: true, address: addressJson(data as AddressRow) }, 201);
}
