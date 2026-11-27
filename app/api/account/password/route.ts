import { getSupabaseAdmin } from "@/lib/supabase";
import { attachSessionCookie, bumpTokenVersion, hashPassword, setSession, verifyPassword } from "@/lib/session";
import { isMissingTable, readBody, reply, requireUser } from "@/lib/account-api";
import { newPasswordError } from "@/lib/password-policy";
import { RULES, rateHit, rateKey, rateReset, smsDailyBudget, tooManyRequests } from "@/lib/rate-limit";
import { consumeOtp, dropOtp, issueOtp, otpMessage, sendOtpSms, smsConfigured } from "@/lib/otp";

export const dynamic = "force-dynamic";

const BAD_CODE = "الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً وحاول مجدداً.";

/**
 * Signed-in password endpoint. A successful change signs the account out everywhere else: every token issued before is
 * revoked and this device receives a new one (`accessToken`, also set as the cookie).
 *
 *   { currentPassword, newPassword }    change: the current password must be right (a stolen session is not enough) and
 *                                       wrong guesses are limited.
 *   { newPassword }                     FIRST password of an account that has none (created with e-mail): no current
 *                                       password exists to ask for. Allowed only while the account has no password;
 *                                       once one is set this form is refused.
 *   { mode: "forgot-request" }          the user is signed in but forgot the current password: an SMS code goes to the
 *                                       phone number of the account (same codes, limits and daily budget as the
 *                                       sign-in "forgot password" flow).
 *   { mode: "forgot-confirm", code, newPassword }   checks the code and sets the new password; this device stays
 *                                       signed in (new `accessToken`), every other session ends.
 */
export async function POST(req: Request) {
  const auth = await requireUser({ allowCustomer: true });
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  const mode = typeof body?.mode === "string" ? body.mode : "change";

  if (mode === "forgot-request") {
    const phone = typeof auth.user.phone === "string" ? auth.user.phone.trim() : "";
    if (!phone) return reply({ error: "أضف رقم الموبايل إلى حسابك أولاً لاستعادة كلمة المرور برسالة نصية" }, 400);
    if (!smsConfigured()) return reply({ error: "خدمة إرسال الرموز غير متاحة حالياً، حاول لاحقاً" }, 503);
    const issued = await issueOtp(auth.user.id, "password_reset", phone);
    if (!issued.ok) {
      if (issued.reason === "failed") {
        if (isMissingTable(issued.error)) return reply({ error: "الخدمة غير مفعّلة بعد على الخادم. تواصل مع الإدارة.", code: "not_ready" }, 503);
        console.error("[api/account/password] issue:", issued.error);
        return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
      }
      return reply({ error: "تم إرسال رمز قبل قليل. انتظر دقيقة ثم اطلب رمزاً جديداً، أو استخدم الرمز الذي وصلك." }, 429);
    }
    const daily = await smsDailyBudget();
    if (!daily.allowed) {
      await dropOtp(issued.id);
      return reply({ error: "تعذر إرسال الرمز حالياً. حاول لاحقاً." }, 503);
    }
    const sent = await sendOtpSms(phone, { code: issued.code, message: otpMessage("password_reset", issued.code) });
    if (!sent) {
      await dropOtp(issued.id);
      return reply({ error: "تعذر إرسال الرمز حالياً. حاول مجدداً بعد قليل." }, 502);
    }
    return reply({ ok: true, message: "تم إرسال رمز التحقق برسالة نصية إلى رقمك. أدخله مع كلمة المرور الجديدة." });
  }

  const next = typeof body?.newPassword === "string" ? body.newPassword : "";
  const policyError = newPasswordError(next);

  if (mode === "forgot-confirm") {
    const phone = typeof auth.user.phone === "string" ? auth.user.phone.trim() : "";
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!phone) return reply({ error: "أضف رقم الموبايل إلى حسابك أولاً" }, 400);
    if (!/^\d{6}$/.test(code)) return reply({ error: "أدخل رمز التحقق المكوّن من 6 أرقام" }, 400);
    if (policyError) return reply({ error: policyError }, 400);
    const result = await consumeOtp(auth.user.id, "password_reset", phone, code);
    if (result === "failed") return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
    if (result !== "ok") return reply({ error: BAD_CODE }, 400);
    return finish(auth.user, hashPassword(next), null, req);
  }

  if (mode !== "change") return reply({ error: "نوع العملية غير صالح" }, 400);
  if (policyError) return reply({ error: policyError }, 400);

  // First password of an account that has none: nothing to check; the update only applies while it is still empty.
  if (!auth.user.password_hash) return finish(auth.user, hashPassword(next), "first", req);

  const current = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  if (!current) return reply({ error: "أدخل كلمة المرور الحالية" }, 400);
  const key = rateKey("password-change", auth.user.id);
  const blocked = await rateHit(key, RULES.loginFailPerAccount, { increment: false });
  if (!blocked.allowed) return tooManyRequests(blocked.retryAfter);
  if (!verifyPassword(String(auth.user.password_hash), current)) {
    const after = await rateHit(key, RULES.loginFailPerAccount);
    return after.allowed ? reply({ error: "كلمة المرور الحالية غير صحيحة" }, 403) : tooManyRequests(after.retryAfter);
  }
  await rateReset(key);
  return finish(auth.user, hashPassword(next), null, req);
}

/** Stores the new hash, ends every other session and gives this device a new token. */
async function finish(
  user: { id: string; role: "workshop" | "marketer" | "customer" | "admin"; name: string; phone: string },
  hash: string,
  only: "first" | null,
  req: Request,
) {
  let query = getSupabaseAdmin().from("users").update({ password_hash: hash }).eq("id", user.id);
  // "first": a second request that raced this one must not overwrite the password that was just set.
  if (only === "first") query = query.is("password_hash", null);
  const { data, error } = await query.select("id");
  if (error) {
    console.error("[api/account/password] update:", error);
    return reply({ error: "تعذر تغيير كلمة المرور" }, 500);
  }
  if (only === "first" && !data?.length) {
    return reply({ error: "لهذا الحساب كلمة مرور بالفعل. استخدم «تغيير كلمة المرور»." }, 409);
  }
  try {
    await bumpTokenVersion(user.id);
  } catch (err) {
    console.error("[api/account/password] revoke sessions:", err);
  }
  const accessToken = await setSession({ id: user.id, role: user.role, name: user.name ?? "", phone: user.phone ?? "" });
  const isWebClient = req.headers.get("x-euro-client") === "web";
  const response = reply({ ok: true, ...(!isWebClient ? { accessToken } : {}), has_password: true });
  return isWebClient ? attachSessionCookie(response, accessToken) : response;
}
