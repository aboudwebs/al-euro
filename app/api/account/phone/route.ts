import { getSupabaseAdmin } from "@/lib/supabase";
import { hashPassword, safeEqual, setSession, signSession } from "@/lib/session";
import { cleanPhone, dbError, readBody, reply, requireUser } from "@/lib/account-api";
import { consumeOtp, dropOtp, issueOtp, otpMessage, sendWhatsAppText, whatsappConfigured } from "@/lib/otp";

export const dynamic = "force-dynamic";

const USER_FIELDS = "id, role, name, phone, city, license, specs, tier, debt_limit, debt_balance, cashback_balance, my_ref_code, is_active, created_at";

/**
 * Changing the phone number (it is also the sign-in name) takes two steps, both bound to the NEW number:
 *   { mode: "request", newPhone, currentPassword }  -> a 6-digit code is sent to the new number on WhatsApp
 *   { mode: "confirm", newPhone, code }              -> the number is changed and a fresh session token is returned
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  if (!body) return reply({ error: "بيانات الطلب غير صالحة" }, 400);

  const newPhone = cleanPhone(body.newPhone);
  if (!newPhone) return reply({ error: "أدخل رقماً صالحاً بالصيغة الدولية (أرقام فقط، مثال 9639XXXXXXXX)" }, 400);
  if (newPhone === auth.user.phone) return reply({ error: "الرقم الجديد مطابق للرقم الحالي" }, 400);

  const db = getSupabaseAdmin();

  if (body.mode === "request") {
    const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
    if (!safeEqual(String(auth.user.password_hash ?? ""), hashPassword(current))) {
      return reply({ error: "كلمة المرور الحالية غير صحيحة" }, 403);
    }
    if (!whatsappConfigured()) return reply({ error: "خدمة إرسال الرموز غير متاحة حالياً، حاول لاحقاً" }, 503);

    const { data: taken, error: takenError } = await db
      .from("users").select("id").eq("phone", newPhone).eq("role", auth.user.role).maybeSingle();
    if (takenError) return dbError("phone lookup", takenError);
    if (taken) return reply({ error: "هذا الرقم مسجل مسبقاً بنفس نوع الحساب" }, 409);

    const issued = await issueOtp(auth.user.id, "phone_change", newPhone);
    if (!issued.ok) {
      if (issued.reason === "throttled") return reply({ error: "انتظر دقيقة قبل طلب رمز جديد (الحد 5 رموز في الساعة)" }, 429);
      return dbError("phone otp issue", issued.error);
    }
    const sent = await sendWhatsAppText(newPhone, otpMessage("phone_change", issued.code));
    if (!sent) {
      await dropOtp(issued.id);
      return reply({ error: "تعذر إرسال الرمز إلى هذا الرقم على واتساب، تأكد من الرقم" }, 502);
    }
    return reply({ ok: true, message: "تم إرسال رمز التحقق إلى الرقم الجديد على واتساب" });
  }

  if (body.mode === "confirm") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^\d{6}$/.test(code)) return reply({ error: "أدخل رمز التحقق المكوّن من 6 أرقام" }, 400);

    const result = await consumeOtp(auth.user.id, "phone_change", newPhone, code);
    if (result === "failed") return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
    if (result !== "ok") return reply({ error: "رمز التحقق غير صحيح أو انتهت صلاحيته" }, 400);

    const { data: user, error } = await db
      .from("users").update({ phone: newPhone }).eq("id", auth.user.id).eq("is_active", true).select(USER_FIELDS).single();
    if (error?.code === "23505") return reply({ error: "هذا الرقم مسجل مسبقاً بنفس نوع الحساب" }, 409);
    if (error || !user) return dbError("phone update", error, "تعذر تغيير الرقم");

    const session = { id: String(user.id), role: user.role, name: user.name, phone: user.phone, my_ref_code: user.my_ref_code };
    setSession(session);
    return reply({ ok: true, user, accessToken: signSession({ ...session, iat: Date.now() }) });
  }

  return reply({ error: "نوع العملية غير صالح" }, 400);
}
