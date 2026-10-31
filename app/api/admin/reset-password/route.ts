import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashPassword, safeEqual } from "@/lib/session";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache" },
  });
}

export async function POST(req: Request) {
  try {
    const resetToken = process.env.ADMIN_PASSWORD_RESET_TOKEN;
    if (!resetToken || resetToken.length < 32) {
      return json({ error: "إعادة التعيين غير مفعّلة. اضبط ADMIN_PASSWORD_RESET_TOKEN في Render." }, 503);
    }

    const body = await req.json();
    const suppliedToken = typeof body?.token === "string" ? body.token : "";
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!safeEqual(suppliedToken, resetToken)) {
      return json({ error: "رمز إعادة التعيين غير صحيح." }, 401);
    }
    if (!phone || password.length < 8 || password.length > 128) {
      return json({ error: "أدخل رقم المدير وكلمة مرور جديدة من 8 إلى 128 حرفاً." }, 400);
    }

    const db = getSupabaseAdmin();
    const { data: user, error: findError } = await db
      .from("users")
      .select("id, phone, role, is_active")
      .eq("phone", phone)
      .eq("role", "admin")
      .maybeSingle();

    if (findError) {
      console.error("[admin-password-reset] lookup failed:", findError);
      return json({ error: "تعذر التحقق من حساب المدير." }, 500);
    }
    if (!user || !user.is_active) {
      return json({ error: "لم يتم العثور على حساب مدير مفعّل بهذا الرقم." }, 404);
    }

    const passwordHash = hashPassword(password);
    const { error: updateError } = await db
      .from("users")
      .update({ password_hash: passwordHash })
      .eq("id", user.id)
      .eq("role", "admin");

    if (updateError) {
      console.error("[admin-password-reset] update failed:", updateError);
      return json({ error: "تعذر تحديث كلمة المرور." }, 500);
    }

    return json({ ok: true, message: "تم تغيير كلمة المرور. احذف ADMIN_PASSWORD_RESET_TOKEN من Render الآن، ثم سجّل الدخول." });
  } catch (error) {
    console.error("[admin-password-reset] request failed:", error);
    return json({ error: "حدث خطأ غير متوقع أثناء إعادة التعيين." }, 500);
  }
}
