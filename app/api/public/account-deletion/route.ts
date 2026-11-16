import crypto from "crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DELETION_GRACE_DAYS } from "@/lib/account-deletion";
import { bumpTokenVersion, forgetAccountState } from "@/lib/session";
import { BodyTooLargeError, clientIp, readJsonLimited } from "@/lib/http";
import { claimRegistrationOtp, issueRegistrationOtp, type OtpClaim } from "@/lib/registration-otp";
import { RULES, rateHit, rateKey, tooManyRequests } from "@/lib/rate-limit";
import { hmacHex, timingSafeEqualHex } from "@/lib/keys";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const FIELDS = "id, requested_at, due_at";
const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;
const EMAIL_RESEND_WAIT_MS = 60 * 1000;
const EMAIL_MAX_ATTEMPTS = 5;
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

function deletionEmailHash(userId: string, code: string) {
  return hmacHex("account-deletion-v1", `account-deletion:${userId}:${code}`);
}
function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "البريد الموثّق المرتبط بالحساب";
  return `${local.slice(0, 1)}•••@${domain}`;
}
async function sendDeletionEmailCode(email: string, code: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [email], subject: "رمز تأكيد حذف حساب EURO",
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#172033"><h2>تأكيد حذف حساب EURO</h2><p>استخدم الرمز التالي لتأكيد طلب حذف حسابك:</p><div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:18px;background:#f2f5f9;text-align:center;border-radius:12px">${code}</div><p>صلاحية الرمز 10 دقائق. إذا لم تطلب حذف الحساب، تجاهل هذه الرسالة.</p></div>`,
      }),
    });
    if (!response.ok) console.error("[public account deletion] email provider rejected:", response.status);
    return response.ok;
  } catch (error) {
    console.error("[public account deletion] email delivery failed:", error);
    return false;
  }
}
async function issueEmailFallback(phone: string, role: AccountRole, ip: string) {
  const ipLimit = await rateHit(rateKey("public-deletion-email-ip", ip), RULES.otpPerIpHour);
  if (!ipLimit.allowed) return { ok: false as const, reason: "throttled" as const, retryAfter: ipLimit.retryAfter };

  const db = getSupabaseAdmin();
  const { data: users, error: userError } = await db.from("users")
    .select("id").eq("phone", phone).eq("role", role).limit(2);
  if (userError) return { ok: false as const, reason: "unavailable" as const };
  if (!users || users.length !== 1) return { ok: true as const, sent: false as const };

  const userId = String(users[0].id);
  const { data: identity, error: identityError } = await db.from("user_auth_identities")
    .select("email").eq("user_id", userId).eq("email_verified", true)
    .not("email", "is", null).limit(1).maybeSingle();
  if (identityError) return { ok: false as const, reason: "unavailable" as const };
  const email = typeof identity?.email === "string" ? identity.email.trim() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: true as const, sent: false as const };
  }

  const { data: previous, error: previousError } = await db.from("account_deletion_email_codes")
    .select("resend_after").eq("user_id", userId).maybeSingle();
  if (previousError) return { ok: false as const, reason: "unavailable" as const };
  if (previous?.resend_after && new Date(previous.resend_after).getTime() > Date.now()) {
    return { ok: false as const, reason: "throttled" as const, retryAfter: Math.ceil((new Date(previous.resend_after).getTime() - Date.now()) / 1000) };
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  const now = Date.now();
  const { error: saveError } = await db.from("account_deletion_email_codes").upsert({
    user_id: userId, code_hash: deletionEmailHash(userId, code),
    expires_at: new Date(now + EMAIL_OTP_TTL_MS).toISOString(),
    resend_after: new Date(now + EMAIL_RESEND_WAIT_MS).toISOString(),
    attempts: 0, created_at: new Date(now).toISOString(),
  }, { onConflict: "user_id" });
  if (saveError) return { ok: false as const, reason: "unavailable" as const };
  if (!await sendDeletionEmailCode(email, code)) {
    await db.from("account_deletion_email_codes").delete().eq("user_id", userId);
    return { ok: false as const, reason: "unavailable" as const };
  }
  return { ok: true as const, sent: true as const, maskedEmail: maskEmail(email) };
}
async function claimEmailFallback(db: ReturnType<typeof getSupabaseAdmin>, userId: string, code: string): Promise<OtpClaim> {
  const { data: row, error } = await db.from("account_deletion_email_codes")
    .select("code_hash, expires_at, attempts").eq("user_id", userId).maybeSingle();
  if (error) return { ok: false, reason: "failed" };
  if (!row || new Date(row.expires_at).getTime() <= Date.now() || Number(row.attempts) >= EMAIL_MAX_ATTEMPTS) {
    return { ok: false, reason: "invalid" };
  }
  const attempts = Number(row.attempts);
  const { data: burned, error: burnError } = await db.from("account_deletion_email_codes")
    .update({ attempts: attempts + 1 }).eq("user_id", userId).eq("attempts", attempts)
    .select("user_id").maybeSingle();
  if (burnError) return { ok: false, reason: "failed" };
  if (!burned) return { ok: false, reason: "invalid" };
  if (!timingSafeEqualHex(String(row.code_hash), deletionEmailHash(userId, code))) {
    return { ok: false, reason: "invalid" };
  }
  const { data: consumed, error: consumeError } = await db.from("account_deletion_email_codes")
    .delete().eq("user_id", userId).eq("attempts", attempts + 1).select("user_id").maybeSingle();
  if (consumeError) return { ok: false, reason: "failed" };
  if (!consumed) return { ok: false, reason: "invalid" };
  return { ok: true, release: async () => undefined };
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
    if (issued.reason === "unconfigured" || issued.reason === "undelivered") {
      const fallback = await issueEmailFallback(phone, role, ip);
      if (!fallback.ok) {
        if (fallback.reason === "throttled") return tooManyRequests(fallback.retryAfter ?? 60);
        return reply({ error: "تعذر إرسال رمز التحقق. تواصل مع الدعم عبر واتساب لإتمام التحقق يدوياً." }, 503);
      }
      const message = fallback.sent
        ? `تعذّر إرسال SMS؛ أرسلنا رمزاً إلى البريد الموثّق المرتبط بالحساب (${fallback.maskedEmail}).`
        : "إذا كان الرقم مرتبطاً بحساب وله بريد موثّق، أرسلنا رمزاً إلى البريد المرتبط به. إذا لم يصلك، تواصل مع الدعم.";
      return reply({ ok: true, channel: "email", otpToken: "", message });
    }
    if (issued.reason === "throttled") return tooManyRequests(issued.retryAfter ?? 60);
    return reply({ error: "خدمة التحقق غير متاحة حالياً. حاول لاحقاً أو تواصل مع الدعم." }, 503);
  }

  if (action !== "confirm-code" || !validRole(role) || (body.channel !== "sms" && body.channel !== "email")) {
    return reply({ error: "نوع الحساب أو العملية غير صالح." }, 400);
  }
  const channel = body.channel;
  const code = typeof body.otpCode === "string" ? body.otpCode.trim() : "";
  const token = typeof body.otpToken === "string" ? body.otpToken.trim() : "";
  if (!/^\d{6}$/.test(code) || (channel === "sms" && !token)) {
    return reply({ error: "أدخل رمز التحقق المكوّن من 6 أرقام." }, 400);
  }

  const ipLimit = await rateHit(rateKey("deletion-otp-verify-ip", clientIp(req)), RULES.otpVerifyPerIp);
  if (!ipLimit.allowed) return tooManyRequests(ipLimit.retryAfter);

  const db = getSupabaseAdmin();
  let claim: OtpClaim | null = null;
  let user: { id: string; role: string; debt_balance: number | null; cashback_balance: number | null };

  if (channel === "sms") {
    const smsClaim = await claimRegistrationOtp(phone, code, token);
    if (!smsClaim.ok) {
      return smsClaim.reason === "failed"
        ? reply({ error: "تعذر التحقق من الرمز حالياً. حاول لاحقاً." }, 503)
        : reply({ error: "رمز التحقق غير صحيح أو انتهت صلاحيته." }, 400);
    }
    claim = smsClaim;
    const { data: users, error: userError } = await db.from("users")
      .select("id, role, debt_balance, cashback_balance")
      .eq("phone", phone).eq("role", role).limit(2);
    if (userError) {
      await releaseOtp(claim);
      return reply({ error: "تعذر التحقق من الحساب. حاول لاحقاً." }, 503);
    }
    if (!users?.length) {
      await releaseOtp(claim);
      return reply({ error: "لم نعثر على حساب بهذا الرقم ونوع الحساب." }, 404);
    }
    if (users.length !== 1) {
      await releaseOtp(claim);
      return reply({ error: "يوجد أكثر من حساب من هذا النوع مرتبط بالرقم. تواصل مع الدعم لتحديد الحساب بأمان." }, 409);
    }
    user = users[0];
  } else {
    const { data: users, error: userError } = await db.from("users")
      .select("id, role, debt_balance, cashback_balance")
      .eq("phone", phone).eq("role", role).limit(2);
    if (userError) return reply({ error: "تعذر التحقق من الحساب. حاول لاحقاً." }, 503);
    if (!users?.length) return reply({ error: "رمز التحقق غير صحيح أو انتهت صلاحيته." }, 400);
    if (users.length !== 1) return reply({ error: "يوجد أكثر من حساب من هذا النوع مرتبط بالرقم. تواصل مع الدعم." }, 409);
    user = users[0];
    const emailClaim = await claimEmailFallback(db, String(user.id), code);
    if (!emailClaim.ok) {
      return emailClaim.reason === "failed"
        ? reply({ error: "تعذر التحقق من الرمز حالياً. حاول لاحقاً." }, 503)
        : reply({ error: "رمز التحقق غير صحيح أو انتهت صلاحيته." }, 400);
    }
    claim = emailClaim;
  }

  if (Number(user.debt_balance ?? 0) > 0) {
    await releaseOtp(claim);
    return reply({ error: "لا يمكن إكمال الطلب مع وجود دين مستحق. سدّد الرصيد أولاً أو تواصل مع الدعم." }, 409);
  }
  if (Number(user.cashback_balance ?? 0) > 0) {
    await releaseOtp(claim);
    return reply({ error: "لديك رصيد كاش باك متاح. استخدمه قبل طلب حذف الحساب حتى لا تفقد قيمته." }, 409);
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

    const { data: hasOpenReferredOrders, error: referredOrdersError } = await db.rpc(
      "marketer_has_open_referred_orders",
      { p_marketer_id: user.id },
    );
    if (referredOrdersError) {
      await releaseOtp(claim);
      return reply({ error: "تعذر التحقق من طلبات الورش المرتبطة. حاول لاحقاً." }, 503);
    }
    if (hasOpenReferredOrders === true) {
      await releaseOtp(claim);
      return reply({ error: "لديك طلبات مفتوحة لدى ورش مرتبطة بك. انتظر إكمالها أو إلغاءها حتى لا تضيع عمولتك." }, 409);
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
