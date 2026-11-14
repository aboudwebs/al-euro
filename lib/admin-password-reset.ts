import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { bumpTokenVersion, hashPassword, safeEqual } from "@/lib/session";
import { newPasswordError } from "@/lib/password-policy";
import { RULES, rateHit, rateKey, tooManyRequests } from "@/lib/rate-limit";
import { BodyTooLargeError, clientIp, readJsonLimited } from "@/lib/http";
import { resetWindow } from "@/lib/admin-reset-rules";

/**
 * One-off administrator password reset, served only at /api/admin/reset-password (the twin /api/password-reset/admin
 * was an identical copy that nothing used and now answers 410). It works only while the server environment holds
 * BOTH ADMIN_PASSWORD_RESET_TOKEN (32+ characters) and ADMIN_PASSWORD_RESET_EXPIRES_AT (an ISO date within the next
 * 24 hours), so a token left behind stops working by itself. Every attempt counts against a per-address limit, the
 * token can be sent in the x-reset-token header (preferred, keeps it out of body logs) or the body, failures are
 * logged without the token, and the answers never say whether an administrator account exists. A successful reset
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
    const resetToken = process.env.ADMIN_PASSWORD_RESET_TOKEN ?? "";
    const window = resetWindow({ token: resetToken, expiresAt: process.env.ADMIN_PASSWORD_RESET_EXPIRES_AT }, Date.now());
    if (window !== "open") {
      return json({ error: "إعادة التعيين غير مفعّلة حالياً." }, 503);
    }

    const ip = clientIp(req);
    const limited = await rateHit(rateKey("admin-reset-ip", ip), RULES.adminResetPerIp);
    if (!limited.allowed) return tooManyRequests(limited.retryAfter);

    let body: Record<string, unknown>;
    try {
      const parsed = await readJsonLimited(req, 8 * 1024);
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch (error) {
      return json({ error: error instanceof BodyTooLargeError ? "حجم الطلب كبير جداً" : "بيانات الطلب غير صالحة" }, error instanceof BodyTooLargeError ? 413 : 400);
    }
    const headerToken = req.headers.get("x-reset-token") ?? "";
    const suppliedToken = headerToken || (typeof body.token === "string" ? body.token : "");
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!safeEqual(suppliedToken, resetToken)) {
      console.warn("[admin-password-reset] rejected attempt: wrong token from", ip.slice(0, 40));
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
      // Same answer as any other failure after the token check: it must not reveal whether this number is an administrator.
      console.warn("[admin-password-reset] rejected attempt: no active administrator for the number, from", ip.slice(0, 40));
      return json({ error: "تعذرت إعادة التعيين. تحقق من البيانات وأعد المحاولة." }, 400);
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

    console.warn("[admin-password-reset] password reset completed for an administrator account");
    return json({ ok: true, message: "تم تغيير كلمة المرور. احذف ADMIN_PASSWORD_RESET_TOKEN و ADMIN_PASSWORD_RESET_EXPIRES_AT من Render الآن، ثم سجّل الدخول." });
  } catch (error) {
    console.error("[admin-password-reset] request failed:", error);
    return json({ error: "حدث خطأ غير متوقع أثناء إعادة التعيين." }, 500);
  }
}
