import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { SPECIAL_STATUS, SPECIAL_STATUSES, SPECIAL_TRANSITIONS, joinRequestNotes, splitRequestNotes, type SpecialStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

/**
 * Body: { quoted_price?: number, note?: string, status?: "priced"|"ordered"|"completed"|"cancelled" }
 * The admin reply is stored after a marker inside special_requests.notes (no extra column is needed).
 * Saving a price on a "new" request moves it to "priced" automatically.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return fail("معرّف الطلب غير صالح");

  const body = await readJson(req);
  if (!body) return fail("بيانات غير صالحة");

  const db = getSupabaseAdmin();
  const { data: current, error: readError } = await db.from("special_requests").select("id, status, notes, quoted_price").eq("id", params.id).maybeSingle();
  if (readError) return dbFail("request read", readError);
  if (!current) return fail("الطلب غير موجود", 404);

  const updates: Record<string, unknown> = {};
  let nextStatus: SpecialStatus | null = null;

  if ("quoted_price" in body && body.quoted_price !== null && body.quoted_price !== "") {
    const price = Number(body.quoted_price);
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000_000) return fail("السعر المقترح غير صالح");
    updates.quoted_price = Math.round(price * 100) / 100;
  }

  if ("note" in body) {
    if (typeof body.note !== "string" || body.note.length > 1000) return fail("الملاحظة غير صالحة");
    updates.notes = joinRequestNotes(splitRequestNotes(current.notes).customer, body.note);
  }

  if ("status" in body) {
    if (typeof body.status !== "string" || !(SPECIAL_STATUSES as string[]).includes(body.status) || body.status === SPECIAL_STATUS.new) {
      return fail("الحالة المطلوبة غير صالحة");
    }
    nextStatus = body.status as SpecialStatus;
  } else if (updates.quoted_price !== undefined && current.status === SPECIAL_STATUS.new) {
    nextStatus = SPECIAL_STATUS.priced;
  }

  if (nextStatus) {
    if (!SPECIAL_TRANSITIONS[current.status as SpecialStatus]?.includes(nextStatus)) return fail("لا يمكن نقل الطلب إلى هذه الحالة من حالته الحالية");
    const effectivePrice = updates.quoted_price ?? current.quoted_price;
    if (nextStatus === SPECIAL_STATUS.priced && !(Number(effectivePrice) > 0)) return fail("أدخل السعر المقترح قبل تحويل الطلب إلى «تم التسعير»");
    updates.status = nextStatus;
  }

  if (!Object.keys(updates).length) return fail("لا توجد تغييرات للحفظ");
  const { data, error } = await db.from("special_requests").update(updates).eq("id", current.id).eq("status", current.status).select("id, status, quoted_price").maybeSingle();
  if (error) return dbFail("request update", error, "تعذر حفظ التعديلات");
  if (!data) return fail("تغيّرت حالة الطلب أثناء التعديل، أعد تحميل الصفحة", 409);
  return ok({ request: data });
}
