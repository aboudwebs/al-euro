import { NextResponse } from "next/server";
import { BRANDS } from "@/lib/data";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { SPECIAL_STATUS, splitRequestNotes } from "@/lib/status";
import { removeImage, storeImage } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const BUCKET = "special-requests";

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
    let session: ReturnType<typeof getSession>;
    try {
      session = getSession();
    } catch {
      return reply({ error: "إعداد AUTH_SECRET مفقود على الخادم" }, 500);
    }
    if (!session) return reply({ error: "يرجى تسجيل الدخول أولاً" }, 401);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return reply({ error: "بيانات الطلب غير صالحة" }, 400);
    }

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
    const { data: user, error: userError } = await db
      .from("users")
      .select("id, name, phone, is_active")
      .eq("id", session.id)
      .maybeSingle();
    if (userError) {
      console.error("[api/special-requests] user lookup:", userError);
      return reply({ error: "تعذر التحقق من الحساب" }, 500);
    }
    if (!user || !user.is_active) return reply({ error: "الحساب غير مفعّل" }, 403);

    let imagePath: string | null = null;
    const file = form.get("image");
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
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("[api/special-requests] insert:", error);
      await removeImage(BUCKET, uploadedPath);
      return reply({ error: "تعذر حفظ الطلب، حاول مجدداً" }, 500);
    }

    return reply({ ok: true, id: data.id });
  } catch (err) {
    console.error("[api/special-requests] POST:", err);
    await removeImage(BUCKET, uploadedPath);
    return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
  }
}

/** The signed-in customer's own special requests, with the admin's quote and reply. */
export async function GET() {
  try {
    let session: ReturnType<typeof getSession>;
    try {
      session = getSession();
    } catch {
      return reply({ error: "إعداد AUTH_SECRET مفقود على الخادم" }, 500);
    }
    if (!session) return reply({ error: "يرجى تسجيل الدخول" }, 401);

    const { data, error } = await getSupabaseAdmin()
      .from("special_requests")
      .select("id, brand, other_brand, part_name, notes, quoted_price, status, created_at")
      .eq("user_id", session.id)
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
