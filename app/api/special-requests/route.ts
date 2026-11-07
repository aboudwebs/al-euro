import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { BRANDS } from "@/lib/data";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireUser } from "@/lib/account-api";
import { SPECIAL_STATUS, splitRequestNotes } from "@/lib/status";
import { removeImage, storeImage } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const BUCKET = "special-requests";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function text(form: FormData, key: string, max: number): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Saves a customer's special request into `special_requests` (optional photo goes to a private bucket). */
export async function POST(req: Request) {
  let uploadedPath: string | null = null;
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return reply({ error: "بيانات الطلب غير صالحة" }, 400);
    }

    const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
    if (!UUID_RE.test(idempotencyKey)) return reply({ error: "تعذر التحقق من محاولة الإرسال. أعد فتح النموذج" }, 400);

    const brand = text(form, "brand", 60);
    const otherBrand = text(form, "otherBrand", 80);
    const partName = text(form, "partName", 120);
    const vinOrOem = text(form, "partNumber", 64);
    const notes = text(form, "notes", 1000);

    const allowedBrands: string[] = [...BRANDS, "أخرى"];
    if (!allowedBrands.includes(brand)) return reply({ error: "ماركة السيارة غير صالحة" }, 400);
    if (brand === "أخرى" && !otherBrand) return reply({ error: "يرجى كتابة نوع السيارة" }, 400);
    if (!partName) return reply({ error: "يرجى إدخال اسم القطعة" }, 400);

    const db = getSupabaseAdmin();
    const user = auth.user;

    const file = form.get("image");
    const requestHash = createHash("sha256").update(JSON.stringify({
      brand, otherBrand: brand === "أخرى" ? otherBrand : "", partName,
      vinOrOem, notes, imageSize: file && typeof file !== "string" ? (file as Blob).size : 0,
    })).digest("hex");

    const { data: previous, error: previousError } = await db
      .from("special_requests")
      .select("id, request_hash")
      .eq("user_id", user.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (previousError) return reply({ error: "تعذر التحقق من الطلب السابق" }, 500);
    if (previous) {
      if (previous.request_hash !== requestHash) {
        return reply({ error: "مفتاح التأكيد مرتبط بطلب مختلف. حدّث قائمة طلباتك قبل المحاولة مجدداً" }, 409);
      }
      return reply({ ok: true, id: previous.id, duplicate: true });
    }

    let imagePath: string | null = null;
    if (file && typeof file === "object" && "arrayBuffer" in file && (file as Blob).size > 0) {
      const stored = await storeImage(BUCKET, String(user.id), file);
      if (!stored.ok) return reply({ error: stored.error }, stored.status);
      imagePath = stored.path;
      uploadedPath = stored.path;
    }

    const { data, error } = await db
      .from("special_requests")
      .insert({
        user_id: user.id,
        customer_name: user.name,
        customer_phone: user.phone,
        brand,
        other_brand: brand === "أخرى" ? otherBrand : null,
        part_name: partName,
        vin_or_oem: vinOrOem || null,
        notes: notes || null,
        image_url: imagePath,
        status: SPECIAL_STATUS.new,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
      })
      .select("id")
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        const { data: duplicate } = await db
          .from("special_requests")
          .select("id, request_hash")
          .eq("user_id", user.id)
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        await removeImage(BUCKET, uploadedPath);
        if (duplicate?.request_hash === requestHash) {
          return reply({ ok: true, id: duplicate.id, duplicate: true });
        }
        return reply({ error: "تم استقبال محاولة التأكيد مسبقاً. حدّث طلباتك للتحقق من النتيجة" }, 409);
      }
      console.error("[api/special-requests] insert:", error);
      await removeImage(BUCKET, uploadedPath);
      return reply({ error: "تعذر حفظ الطلب، حاول مجدداً" }, 500);
    }

    return reply({ ok: true, id: data.id, duplicate: false });
  } catch (err) {
    console.error("[api/special-requests] POST:", err);
    await removeImage(BUCKET, uploadedPath);
    return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
  }
}

/** The signed-in customer's own special requests, with the admin's quote and reply. */
export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const { data, error } = await getSupabaseAdmin()
      .from("special_requests")
      .select("id, brand, other_brand, part_name, notes, quoted_price, status, created_at")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      console.error("[api/special-requests] list:", error);
      return reply({ error: "تعذر تحميل طلباتك الخاصة" }, 500);
    }
    const requests = (data ?? []).map(({ notes, ...r }) => ({ ...r, admin_note: splitRequestNotes(notes).admin }));
    return reply({ requests });
  } catch (err) {
    console.error("[api/special-requests] GET:", err);
    return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
  }
}
