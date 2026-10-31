import { getSupabaseAdmin } from "@/lib/supabase";
import { dbError, isUuid, readBody, reply, requireUser } from "@/lib/account-api";
import { addressJson, parseAddress, type AddressRow } from "@/lib/account-data";

export const dynamic = "force-dynamic";

const FIELDS = "id, label, governorate, area, street, details, phone, is_default";

/** Body: any of { label, governorate, area, street, details, phone, isDefault }. Only the owner's address can change. */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!isUuid(params.id)) return reply({ error: "معرّف العنوان غير صالح" }, 400);
  const body = await readBody(req);
  if (!body) return reply({ error: "بيانات الطلب غير صالحة" }, 400);
  const parsed = parseAddress(body, true);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);

  const updates: Record<string, unknown> = { ...parsed.value };
  if (body.isDefault === true) updates.is_default = true;
  if (!Object.keys(updates).length) return reply({ error: "لا توجد تغييرات للحفظ" }, 400);
  updates.updated_at = new Date().toISOString();

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("user_addresses")
    .update(updates)
    .eq("id", params.id)
    .eq("user_id", auth.user.id)
    .select(FIELDS)
    .maybeSingle();
  if (error) return dbError("address update", error, "تعذر حفظ العنوان");
  if (!data) return reply({ error: "العنوان غير موجود" }, 404);

  if (body.isDefault === true) {
    await db.from("user_addresses").update({ is_default: false }).eq("user_id", auth.user.id).neq("id", params.id);
  }
  return reply({ ok: true, address: addressJson(data as AddressRow) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!isUuid(params.id)) return reply({ error: "معرّف العنوان غير صالح" }, 400);

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("user_addresses")
    .delete()
    .eq("id", params.id)
    .eq("user_id", auth.user.id)
    .select("id, is_default")
    .maybeSingle();
  if (error) return dbError("address delete", error, "تعذر حذف العنوان");
  if (!data) return reply({ error: "العنوان غير موجود" }, 404);

  // The default address was removed: the oldest remaining one becomes the default.
  if (data.is_default) {
    const { data: next } = await db
      .from("user_addresses").select("id").eq("user_id", auth.user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (next) await db.from("user_addresses").update({ is_default: true }).eq("id", next.id).eq("user_id", auth.user.id);
  }
  return reply({ ok: true });
}
