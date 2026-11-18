import { getSupabaseAdmin } from "@/lib/supabase";
import { bumpTokenVersion, setSession, verifyPassword } from "@/lib/session";
import { RULES, rateHit, rateKey, rateReset, smsDailyBudget, tooManyRequests } from "@/lib/rate-limit";
import { accountFlags } from "@/lib/account-flags";
import { cleanPhone, dbError, isUndefinedColumn, readBody, reply, requireUser } from "@/lib/account-api";
import { consumeOtp, dropOtp, issueOtp, otpMessage, sendOtpSms, smsConfigured } from "@/lib/otp";

export const dynamic = "force-dynamic";

const USER_FIELDS = "id, role, name, phone, city, license, specs, tier, debt_limit, debt_balance, cashback_balance, my_ref_code, is_active, created_at";

/**
 * Changing the phone number (it is also the sign-in name) takes two steps, both bound to the NEW number:
 *   { mode: "request", newPhone, currentPassword }  -> a 6-digit code is sent to the new number by SMS (MsgPlus)
 *   { mode: "confirm", newPhone, code }              -> the number is changed and a fresh session token is returned
 *
 * An account created with e-mail has no phone number and no password yet. Such an account ADDS its number without a
 * current password (the SMS code to the new number is the proof). An account that has a password must give it; an
 * account that has a phone but no password must add a password first (nothing else would protect the change).
 * Confirming a number with the code also marks it verified (phone_verified_at, phone_verification_required=false).
 */
export async function POST(req: Request) {
  const auth = await requireUser({ allowCustomer: true });
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  if (!body) return reply({ error: "بيانات الطلب غير صالحة" }, 400);

  const newPhone = cleanPhone(body.newPhone);
  if (!newPhone) return reply({ error: "أدخل رقماً صالحاً بالصيغة الدولية (أرقام فقط، مثال 9639XXXXXXXX)" }, 400);
  if (newPhone === auth.user.phone) return reply({ error: "الرقم الجديد مطابق للرقم الحالي" }, 400);

  const db = getSupabaseAdmin();

  if (body.mode === "request") {
    const hasPassword = Boolean(auth.user.password_hash);
    const hasPhone = typeof auth.user.phone === "string" && auth.user.phone.trim().length > 0;
    if (!hasPassword && hasPhone) {
      return reply({ error: "أضف كلمة مرور لحسابك أولاً ثم غيّر رقم الموبايل" }, 403);
    }
    if (hasPassword) {
      const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
      // (The old check compared the stored hash with a freshly salted hash, so it could never match.)
      const key = rateKey("password-check", auth.user.id);
      const blocked = await rateHit(key, RULES.loginFailPerAccount, { increment: false });
      if (!blocked.allowed) return tooManyRequests(blocked.retryAfter);
      if (!verifyPassword(String(auth.user.password_hash), current)) {
        const after = await rateHit(key, RULES.loginFailPerAccount);
        return after.allowed ? reply({ error: "كلمة المرور الحالية غير صحيحة" }, 403) : tooManyRequests(after.retryAfter);
      }
      await rateReset(key);
    }
    if (!smsConfigured()) return reply({ error: "خدمة إرسال الرموز غير متاحة حالياً، حاول لاحقاً" }, 503);

    const { data: taken, error: takenError } = await db
      .from("users").select("id").eq("phone", newPhone).eq("role", auth.user.role).maybeSingle();
    if (takenError) return dbError("phone lookup", takenError);
    if (taken) return reply({ error: "هذا الرقم مسجل مسبقاً بنفس نوع الحساب" }, 409);

    const issued = await issueOtp(auth.user.id, "phone_change", newPhone);
    if (!issued.ok) {
      if (issued.reason === "throttled") return reply({ error: "انتظر دقيقة قبل طلب رمز جديد (الحد 5 رموز في الساعة)" }, 429);
      return dbError("phone otp issue", issued.error);
    }
    const daily = await smsDailyBudget();
    if (!daily.allowed) {
      await dropOtp(issued.id);
      return tooManyRequests(daily.retryAfter);
    }
    const sent = await sendOtpSms(newPhone, { code: issued.code, message: otpMessage("phone_change", issued.code) });
    if (!sent) {
      await dropOtp(issued.id);
      return reply({ error: "تعذر إرسال الرمز إلى هذا الرقم، تأكد من الرقم وحاول مجدداً" }, 502);
    }
    return reply({ ok: true, message: "تم إرسال رمز التحقق إلى الرقم الجديد برسالة نصية" });
  }

  if (body.mode === "confirm") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^\d{6}$/.test(code)) return reply({ error: "أدخل رمز التحقق المكوّن من 6 أرقام" }, 400);

    const result = await consumeOtp(auth.user.id, "phone_change", newPhone, code);
    if (result === "failed") return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
    if (result !== "ok") return reply({ error: "رمز التحقق غير صحيح أو انتهت صلاحيته" }, 400);

    // The code proves the owner holds this number: it is stored as verified. (Old schemas without the verification
    // columns still get the number.)
    const verified = { phone: newPhone, phone_verified_at: new Date().toISOString(), phone_verification_required: false };
    let { data: user, error } = await db
      .from("users").update(verified).eq("id", auth.user.id).eq("is_active", true).select(USER_FIELDS).single();
    if (isUndefinedColumn(error)) {
      ({ data: user, error } = await db
        .from("users").update({ phone: newPhone }).eq("id", auth.user.id).eq("is_active", true).select(USER_FIELDS).single());
    }
    if (error?.code === "23505") return reply({ error: "هذا الرقم مسجل مسبقاً بنفس نوع الحساب" }, 409);
    if (error || !user) return dbError("phone update", error, "تعذر تغيير الرقم");

    // Tokens carry the phone number: every token issued with the old number is revoked, this device gets a new one.
    try {
      await bumpTokenVersion(String(user.id));
    } catch (err) {
      console.error("[api/account/phone] revoke sessions:", err);
    }
    const accessToken = await setSession({ id: String(user.id), role: user.role, name: user.name, phone: user.phone, my_ref_code: user.my_ref_code });
    const flags = accountFlags({ phone: user.phone, password_hash: auth.user.password_hash, phone_verification_required: false });
    return reply({ ok: true, user: { ...user, ...flags }, accessToken });
  }

  return reply({ error: "نوع العملية غير صالح" }, 400);
}
