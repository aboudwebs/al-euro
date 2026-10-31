import { getSupabaseAdmin } from "@/lib/supabase";
import { hashPassword } from "@/lib/session";
import { isMissingTable, readBody, reply } from "@/lib/account-api";
import { consumeOtp, dropOtp, issueOtp, otpMessage, sendWhatsAppText, whatsappConfigured } from "@/lib/otp";

export const dynamic = "force-dynamic";

/**
 * Forgot password for workshops and marketers (no signed-in session). The project has no e-mail addresses and no
 * Supabase Auth: the account is the phone number, so the recovery link is replaced by a WhatsApp code sent to the
 * phone number of the account (the same channel as the sign-up code).
 *
 *   { mode: "request", phone, role }                          -> always answers the same text, whether or not the
 *                                                                number is registered
 *   { mode: "confirm", phone, role, code, newPassword }       -> checks the code and sets the new password
 */
const SENT = "إن كان الرقم مسجلاً لدينا فسيصلك رمز التحقق على واتساب خلال دقيقة.";
const BAD_CODE = "الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً وحاول مجدداً.";

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    if (!body) return reply({ error: "بيانات الطلب غير صالحة" }, 400);

    const role = body.role;
    if (role !== "workshop" && role !== "marketer") return reply({ error: "نوع الحساب غير صالح" }, 400);
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (phone.length < 8 || phone.length > 20) return reply({ error: "أدخل رقم الموبايل المسجل في حسابك" }, 400);

    const db = getSupabaseAdmin();
    const { data: user, error: lookupError } = await db
      .from("users").select("id, phone, is_active").eq("phone", phone).eq("role", role).maybeSingle();
    if (lookupError) {
      console.error("[password-reset/user] lookup:", lookupError);
      return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
    }

    if (body.mode === "request") {
      if (!whatsappConfigured()) return reply({ error: "خدمة إرسال الرموز غير متاحة حالياً، حاول لاحقاً" }, 503);
      if (!user || !user.is_active) return reply({ ok: true, message: SENT });

      const issued = await issueOtp(String(user.id), "password_reset", String(user.phone));
      if (!issued.ok) {
        if (issued.reason === "failed") {
          if (isMissingTable(issued.error)) return reply({ error: "الخدمة غير مفعّلة بعد على الخادم. تواصل مع الإدارة.", code: "not_ready" }, 503);
          console.error("[password-reset/user] issue:", issued.error);
          return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
        }
        return reply({ ok: true, message: SENT }); // asked again too soon: same answer, no new message
      }
      // Not awaited on purpose: the answer must not be slower for a registered number than for an unknown one.
      void sendWhatsAppText(String(user.phone), otpMessage("password_reset", issued.code)).then(async (sent) => {
        if (!sent) await dropOtp(issued.id);
      }).catch(() => undefined);
      return reply({ ok: true, message: SENT });
    }

    if (body.mode === "confirm") {
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const next = typeof body.newPassword === "string" ? body.newPassword : "";
      if (!/^\d{6}$/.test(code)) return reply({ error: "أدخل رمز التحقق المكوّن من 6 أرقام" }, 400);
      if (next.length < 4 || next.length > 128) return reply({ error: "كلمة المرور الجديدة يجب أن تكون بين 4 و128 حرفاً" }, 400);
      if (!user || !user.is_active) return reply({ error: BAD_CODE }, 400);

      const result = await consumeOtp(String(user.id), "password_reset", String(user.phone), code);
      if (result === "failed") return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
      if (result !== "ok") return reply({ error: BAD_CODE }, 400);

      const { error } = await db.from("users").update({ password_hash: hashPassword(next) }).eq("id", user.id);
      if (error) {
        console.error("[password-reset/user] update:", error);
        return reply({ error: "تعذر تغيير كلمة المرور" }, 500);
      }
      return reply({ ok: true, message: "تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة." });
    }

    return reply({ error: "نوع العملية غير صالح" }, 400);
  } catch (err) {
    console.error("[password-reset/user] POST:", err);
    return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
  }
}
