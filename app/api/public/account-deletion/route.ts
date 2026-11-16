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
type AccountRole = "workshop" | "marketer";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}
function requestJson(row: { id: string; requested_at: string; due_at: string }) {
  return { id: row.id, requestedAt: row.requested_at, dueAt: row.due_at, graceDays: DELETION_GRACE_DAYS };
}
function validPhone(value: unknown): value is string {
  return typeof value === "string" && /^\+?[0-9]{8,15}$/.test(value.trim());
}
function validRole(value: unknown): value is AccountRole {
  return value === "workshop" || value === "marketer";
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

  if (action === "send-code") {
    const issued = await issueRegistrationOtp(phone, clientIp(req));
    if (!issued.ok) {
      if (issued.reason === "throttled") return tooManyRequests(issued.retryAfter ?? 60);
      if (issued.reason === "unavailable" || issued.reason === "unconfigured") {
        return reply({ error: "خدمة التحقق غير متاحة حالياً. حاول لاحقاً أو تواصل مع الدعم." }, 503);
      }
      return reply({ error: "تعذر إرسال الرسالة. تحقق من الرقم وحاول مجدداً." }, 502);
    }
    return reply({
      ok: true,
      otpToken: issued.token,
      message: "إذا كان الرقم مرتبطاً بحساب، سيصلك رمز تحقق برسالة نصية. الرمز صالح لمدة 10 دقائق.",
    });
  }

  if (action !== "confirm-code" || !validRole(body.role)) {
    return reply({ error: "نوع الحساب أو العملية غير صالح." }, 400);
  }
  const code = typeof body.otpCode === "string" ? body.otpCode.trim() : "";
  const token = typeof body.otpToken === "string" ? body.otpToken.trim() : "";
  if (!/^\d{6}$/.test(code) || !token) return reply({ error: "أدخل رمز التحقق المكوّن من 6 أرقام." }, 400);

  const ipLimit = await rateHit(rateKey("deletion-otp-verify-ip", clientIp(req)), RULES.otpVerifyPerIp);
  if (!ipLimit.allowed) return tooManyRequests(ipLimit.retryAfter);

  let claim: OtpClaim | null = await claimRegistrationOtp(phone, code, token);
  if (!claim.ok) {
    return claim.reason === "failed"
      ? reply({ error: "تعذر التحقق من الرمز حالياً. حاول لاحقاً." }, 503)
      : reply({ error: "رمز التحقق غير صحيح أو انتهت صلاحيته." }, 400);
  }

  const db = getSupabaseAdmin();
  const { data: users, error: userError } = await db.from("users")
    .select("id, role, debt_balance")
    .eq("phone", phone)
    .eq("role", body.role)
    .limit(2);
  if (userError) {
    await releaseOtp(claim);
    return reply({ error: "تعذر التحقق من الحساب. حاول لاحقاً." }, 503);
  }
  if (!users?.length) return reply({ error: "لم نعثر على حساب بهذا الرقم ونوع الحساب." }, 404);
  if (users.length !== 1) return reply({
    error: "يوجد أكثر من حساب من هذا النوع مرتبط بالرقم. تواصل مع الدعم لتحديد الحساب بأمان.",
  }, 409);

  const user = users[0];
  if (Number(user.debt_balance ?? 0) > 0) {
    await releaseOtp(claim);
    return reply({ error: "لا يمكن إكمال الطلب مع وجود دين مستحق. سدّد الرصيد أولاً أو تواصل مع الدعم." }, 409);
  }

  const { count: activeOrders, error: ordersError } = await db.from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id).in("status", ["pending", "approved", "shipped"]);
  if (ordersError) {
    await releaseOtp(claim);
    return reply({ error: "تعذر التحقق من الطلبات. حاول لاحقاً." }, 503);
  }
  if ((activeOrders ?? 0) > 0) {
    await releaseOtp(claim);
    return reply({ error: "لديك طلبات قيد التنفيذ. انتظر إكمالها أو إلغاءها قبل طلب حذف الحساب." }, 409);
  }

  const { count: activeSpecial, error: specialError } = await db.from("special_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id).in("status", ["new", "priced", "ordered"]);
  if (specialError) {
    await releaseOtp(claim);
    return reply({ error: "تعذر التحقق من الطلبات الخاصة. حاول لاحقاً." }, 503);
  }
  if ((activeSpecial ?? 0) > 0) {
    await releaseOtp(claim);
    return reply({ error: "لديك طلبات قطع خاصة قيد المعالجة. انتظر إكمالها أو إلغاءها أولاً." }, 409);
  }

  if (user.role === "marketer") {
    const { count: pendingPayouts, error: payoutError } = await db.from("marketer_payout_requests")
      .select("id", { count: "exact", head: true })
      .eq("marketer_id", user.id).eq("status", "pending");
    if (payoutError) {
      await releaseOtp(claim);
      return reply({ error: "تعذر التحقق من طلبات السحب. حاول لاحقاً." }, 503);
    }
    if ((pendingPayouts ?? 0) > 0) {
      await releaseOtp(claim);
      return reply({ error: "لديك طلب سحب قيد المراجعة. انتظر تسويته قبل حذف الحساب." }, 409);
    }

    const { count: unsettled, error: commissionError } = await db.from("marketer_commissions")
      .select("id", { count: "exact", head: true })
      .eq("marketer_id", user.id).in("status", ["held", "available", "payout_requested"]);
    if (commissionError) {
      await releaseOtp(claim);
      return reply({ error: "تعذر التحقق من العمولات. حاول لاحقاً." }, 503);
    }
    if ((unsettled ?? 0) > 0) {
      await releaseOtp(claim);
      return reply({ error: "لديك عمولات غير مسوّاة. تواصل مع الإدارة لتسويتها قبل حذف الحساب." }, 409);
    }
  }

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
