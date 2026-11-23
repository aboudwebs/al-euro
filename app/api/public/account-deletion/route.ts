import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DELETION_GRACE_DAYS } from "@/lib/account-deletion";
import { bumpTokenVersion, forgetAccountState } from "@/lib/session";
import { BodyTooLargeError, clientIp, readJsonLimited } from "@/lib/http";
import { claimRegistrationOtp, issueRegistrationOtp, type OtpClaim } from "@/lib/registration-otp";
import { RULES, rateHit, rateKey, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const FIELDS = "id, requested_at, due_at";
type AccountRole = "workshop" | "marketer" | "customer";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}
function requestJson(row: { id: string; requested_at: string; due_at: string }) {
  return { id: row.id, requestedAt: row.requested_at, dueAt: row.due_at, graceDays: DELETION_GRACE_DAYS };
}
function validPhone(value: unknown): value is string {
  return typeof value === "string" && /^\+?[0-9]{8,15}$/.test(value.trim());
}

/** Resolve equivalent Syrian mobile formats without matching by an unsafe suffix. */
function phoneLookupVariants(value: string): string[] {
  const raw = value.trim();
  const digits = raw.replace(/\D/g, "");
  const variants = new Set<string>([raw]);
  let international = digits.startsWith("00") ? digits.slice(2) : digits;

  if (international.startsWith("0") && international.length === 10) {
    international = `963${international.slice(1)}`;
  } else if (international.startsWith("9") && international.length === 9) {
    international = `963${international}`;
  }

  if (international.startsWith("963") && international.length === 12) {
    variants.add(international);
    variants.add(`+${international}`);
    variants.add(`00${international}`);
    variants.add(`0${international.slice(3)}`);
  }
  return [...variants];
}
function validRole(value: unknown): value is AccountRole {
  return value === "workshop" || value === "marketer" || value === "customer";
}
async function releaseOtp(claim: OtpClaim | null) {
  if (claim?.ok) await claim.release();
}

/**
 * Public Google Play account-deletion flow.
 * The phone OTP is one-time, expires after 10 minutes and uses the shared MsgPlus rate limits.
 * POST { action: "send-code", phone } or { action: "confirm-code", phone, role, otpCode, otpToken }.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed = await readJsonLimited(req, 16 * 1024);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (error) {
    if (error instanceof BodyTooLargeError) return reply({ error: "حجم الطلب كبير جداً" }, 413);
    return reply({ error: "بيانات الطلب غير صالحة" }, 400);
  }

  const action = body.action;
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!validPhone(phone)) return reply({ error: "أدخل رقم الهاتف المسجّل بالحساب بصيغة صحيحة." }, 400);

  const role = body.role;
  if (action === "send-code") {
    if (!validRole(role)) return reply({ error: "اختر نوع الحساب." }, 400);
    const ip = clientIp(req);
    const issued = await issueRegistrationOtp(phone, ip);
    if (issued.ok) {
      return reply({
        ok: true, channel: "sms", otpToken: issued.token,
        message: "أرسلنا رمز تحقق برسالة SMS إلى الرقم المدخل. الرمز صالح لمدة 10 دقائق.",
      });
    }
    if (issued.reason === "unconfigured" || issued.reason === "undelivered") return reply({ error: "تعذر إرسال رمز SMS حالياً. حاول لاحقاً أو تواصل مع الدعم." }, 503);
    if (issued.reason === "throttled") return tooManyRequests(issued.retryAfter ?? 60);
    return reply({ error: "خدمة التحقق غير متاحة حالياً. حاول لاحقاً أو تواصل مع الدعم." }, 503);
  }

  if (action !== "confirm-code" || !validRole(role)) return reply({ error: "نوع الحساب أو العملية غير صالح." }, 400);
  const code = typeof body.otpCode === "string" ? body.otpCode.trim() : "";
  const token = typeof body.otpToken === "string" ? body.otpToken.trim() : "";
  if (!/^\d{6}$/.test(code) || !token) return reply({ error: "أدخل رمز SMS المكوّن من 6 أرقام." }, 400);

  const ipLimit = await rateHit(rateKey("deletion-otp-verify-ip", clientIp(req)), RULES.otpVerifyPerIp);
  if (!ipLimit.allowed) return tooManyRequests(ipLimit.retryAfter);

  const db = getSupabaseAdmin();
  let claim: OtpClaim | null = null;
  let user: { id: string; role: string; debt_balance: number | null; cashback_balance: number | null };

  const smsClaim = await claimRegistrationOtp(phone, code, token);
  if (!smsClaim.ok) return smsClaim.reason === "failed"
    ? reply(req, { error: "تعذر التحقق من الرمز حالياً. حاول لاحقاً." }, 503)
    : reply(req, { error: "رمز SMS غير صحيح أو انتهت صلاحيته." }, 400);
  claim = smsClaim;
  const { data: users, error: userError } = await db.from("users")
    .select("id, role, debt_balance, cashback_balance")
    .in("phone", phoneLookupVariants(phone)).eq("role", role).limit(2);
  if (userError) { await releaseOtp(claim); return reply({ error: "تعذر التحقق من الحساب. حاول لاحقاً." }, 503); }
  if (!users?.length) { await releaseOtp(claim); return reply({ error: "لم نعثر على حساب بهذا الرقم ونوع الحساب." }, 404); }
  if (users.length !== 1) { await releaseOtp(claim); return reply({ error: "يوجد أكثر من حساب من هذا النوع مرتبط بالرقم. تواصل مع الدعم لتحديد الحساب بأمان." }, 409); }
  user = users[0];

  // Debts, cashback, commissions, payout requests and open commercial records are retained
  // for settlement and do not block removal of the user's personal identity.

  const { data: existing, error: existingError } = await db.from("account_deletion_requests")
    .select(FIELDS).eq("user_id", user.id).eq("status", "pending").maybeSingle();
  if (existingError) {
    await releaseOtp(claim);
    return reply({ error: "تعذر قراءة حالة طلب الحذف. حاول لاحقاً." }, 503);
  }
  if (existing) return reply({ ok: true, request: requestJson(existing) });

  const dueAt = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: created, error: createError } = await db.from("account_deletion_requests")
    .insert({ user_id: user.id, due_at: dueAt }).select(FIELDS).single();

  if (createError?.code === "23505") {
    const { data: concurrent } = await db.from("account_deletion_requests")
      .select(FIELDS).eq("user_id", user.id).eq("status", "pending").maybeSingle();
    if (concurrent) return reply({ ok: true, request: requestJson(concurrent) });
  }
  if (createError || !created) {
    await releaseOtp(claim);
    console.error("[public/account-deletion] create:", createError);
    return reply({ error: "تعذر تسجيل طلب الحذف. حاول لاحقاً." }, 500);
  }

  try {
    await bumpTokenVersion(String(user.id));
    forgetAccountState(String(user.id));
  } catch (error) {
    console.error("[public/account-deletion] session revocation:", error);
  }

  return reply({
    ok: true,
    message: "تم تسجيل طلب حذف الحساب. ستُزال البيانات الشخصية بعد انتهاء مهلة الـ30 يوماً، ويمكن إلغاء الطلب خلال المهلة من التطبيق.",
    request: requestJson(created),
  }, 201);
}
