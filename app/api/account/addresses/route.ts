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

  const db = getSupabaseAdmin();
  const { count, error: countError } = await db.from("user_addresses").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id);
  if (countError) return dbError("addresses count", countError, "تعذر حفظ العنوان");
  if ((count ?? 0) >= MAX_ADDRESSES) return reply({ error: `الحد الأقصى ${MAX_ADDRESSES} عناوين، احذف عنواناً قبل إضافة آخر` }, 400);

  const makeDefault = body.isDefault === true || (count ?? 0) === 0;
  const { data, error } = await db
    .from("user_addresses")
    .insert({ ...parsed.value, user_id: auth.user.id, is_default: makeDefault })
    .select(FIELDS)
    .single();
  if (error || !data) return dbError("address insert", error, "تعذر حفظ العنوان");

  if (makeDefault) {
    await db.from("user_addresses").update({ is_default: false }).eq("user_id", auth.user.id).neq("id", data.id);
  }
  return reply({ ok: true, address: addressJson(data as AddressRow) }, 201);
}
