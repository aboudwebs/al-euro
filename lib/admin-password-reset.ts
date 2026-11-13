import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { bumpTokenVersion, hashPassword, safeEqual } from "@/lib/session";
import { newPasswordError } from "@/lib/password-policy";
import { RULES, rateHit, rateKey, tooManyRequests } from "@/lib/rate-limit";
import { BodyTooLargeError, clientIp, readJsonLimited } from "@/lib/http";

/**
 * One-off administrator password reset, shared by /api/password-reset/admin and /api/admin/reset-password (the two
 * routes were identical copies). It only works while ADMIN_PASSWORD_RESET_TOKEN (32+ characters) is set in the server's
 * environment; every attempt counts against a per-address limit so the token cannot be guessed; a successful reset
 * revokes every session of that administrator. Two-step verification, when enrolled, is NOT bypassed by this reset.
 */
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

    const limited = await rateHit(rateKey("admin-reset-ip", clientIp(req)), RULES.adminResetPerIp);
    if (!limited.allowed) return tooManyRequests(limited.retryAfter);

    let body: Record<string, unknown>;
    try {
      const parsed = await readJsonLimited(req, 8 * 1024);
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch (error) {
      return json({ error: error instanceof BodyTooLargeError ? "حجم الطلب كبير جداً" : "بيانات الطلب غير صالحة" }, error instanceof BodyTooLargeError ? 413 : 400);
    }
    const suppliedToken = typeof body.token === "string" ? body.token : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!safeEqual(suppliedToken, resetToken)) {
      return json({ error: "رمز إعادة التعيين غير صحيح." }, 401);
    }
    const policyError = newPasswordError(password);
    if (!phone || policyError) {
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

    const { error: updateError } = await db
      .from("users")
      .update({ password_hash: hashPassword(password) })
      .eq("id", user.id)
      .eq("role", "admin");

    if (updateError) {
      console.error("[admin-password-reset] update failed:", updateError);
      return json({ error: "تعذر تحديث كلمة المرور." }, 500);
    }
    try {
      await bumpTokenVersion(String(user.id));
    } catch (err) {
      console.error("[admin-password-reset] revoke sessions:", err);
    }

    return json({ ok: true, message: "تم تغيير كلمة المرور. احذف ADMIN_PASSWORD_RESET_TOKEN من Render الآن، ثم سجّل الدخول." });
  } catch (error) {
    console.error("[admin-password-reset] request failed:", error);
    return json({ error: "حدث خطأ غير متوقع أثناء إعادة التعيين." }, 500);
  }
}
