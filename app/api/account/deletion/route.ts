import { getSupabaseAdmin } from "@/lib/supabase";
import { DELETION_GRACE_DAYS } from "@/lib/account-deletion";
import { dbError, readBody, reply, requireUser } from "@/lib/account-api";
import { claimRegistrationOtp, issueRegistrationOtp } from "@/lib/registration-otp";
import { clientIp } from "@/lib/http";

export const dynamic = "force-dynamic";
const FIELDS = "id, requested_at, due_at";

function requestJson(r: { requested_at: string; due_at: string }) {
  return { requestedAt: r.requested_at, dueAt: r.due_at, graceDays: DELETION_GRACE_DAYS };
}

export async function GET() {
  const auth = await requireUser({ allowCustomer: true });
  if (!auth.ok) return auth.response;
  const { data, error } = await getSupabaseAdmin().from("account_deletion_requests")
    .select(FIELDS).eq("user_id", auth.user.id).eq("status", "pending").maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return reply({ request: null, ready: false });
    return dbError("deletion status", error, "تعذر قراءة حالة الحذف");
  }
  return reply({ request: data ? requestJson(data) : null, ready: true });
}

/** POST { action: "send-code" } or { action: "confirm-code", code, otpToken }. SMS via MsgPlus only. */
export async function POST(req: Request) {
  const auth = await requireUser({ allowCustomer: true });
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  const action = body?.action;
  const phone = typeof auth.user.phone === "string" ? auth.user.phone.trim() : "";

  if (!phone || phone.replace(/\D/g, "").length < 8) {
    return reply({ error: "أضف رقم هاتف موثّقاً إلى حسابك أولاً لإرسال رمز الحذف عبر SMS." }, 409);
  }

  if (action === "send-code") {
    const issued = await issueRegistrationOtp(phone, clientIp(req));
    if (!issued.ok) {
      if (issued.reason === "throttled") return reply({ error: "انتظر قليلاً قبل طلب رمز جديد." }, 429);
      return reply({ error: "تعذر إرسال رمز SMS حالياً. حاول لاحقاً أو تواصل مع الدعم." }, 503);
    }
    return reply({ ok: true, otpToken: issued.token, message: "أرسلنا رمز تأكيد حذف الحساب إلى رقم هاتفك برسالة SMS. الرمز صالح لمدة 10 دقائق." });
  }

  if (action !== "confirm-code") return reply({ error: "طلب غير صالح" }, 400);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const otpToken = typeof body?.otpToken === "string" ? body.otpToken.trim() : "";
  if (!/^\d{6}$/.test(code) || !otpToken) {
    return reply({ error: "أدخل رمز SMS المكوّن من 6 أرقام." }, 400);
  }

  const claim = await claimRegistrationOtp(phone, code, otpToken);
  if (!claim.ok) {
    return claim.reason === "failed"
      ? reply({ error: "تعذر التحقق من الرمز حالياً. حاول لاحقاً." }, 503)
      : reply({ error: "رمز SMS غير صحيح أو انتهت صلاحيته." }, 400);
  }

  const db = getSupabaseAdmin();
  const { data: existing, error: existingError } = await db.from("account_deletion_requests").select(FIELDS)
    .eq("user_id", auth.user.id).eq("status", "pending").maybeSingle();
  if (existingError) {
    await claim.release();
    return dbError("deletion existing", existingError, "تعذر حفظ الطلب");
  }
  if (existing) return reply({ ok: true, request: requestJson(existing) });

  const due = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db.from("account_deletion_requests")
    .insert({ user_id: auth.user.id, due_at: due }).select(FIELDS).single();
  if (error?.code === "23505") {
    const { data: again } = await db.from("account_deletion_requests").select(FIELDS)
      .eq("user_id", auth.user.id).eq("status", "pending").maybeSingle();
    if (again) return reply({ ok: true, request: requestJson(again) });
  }
  if (error || !data) {
    await claim.release();
    return dbError("deletion insert", error, "تعذر حفظ الطلب");
  }
  return reply({ ok: true, request: requestJson(data) }, 201);
}

export async function DELETE() {
  const auth = await requireUser({ allowCustomer: true });
  if (!auth.ok) return auth.response;
  const { data, error } = await getSupabaseAdmin().from("account_deletion_requests")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("user_id", auth.user.id).eq("status", "pending")
    .select("id").maybeSingle();
  if (error) return dbError("deletion cancel", error, "تعذر إلغاء الطلب");
  if (!data) return reply({ error: "لا يوجد طلب حذف قيد الانتظار؛ ربما اكتمل الحذف بالفعل" }, 404);
  return reply({ ok: true });
}
