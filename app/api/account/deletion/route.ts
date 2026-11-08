import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { DELETION_GRACE_DAYS } from "@/lib/account-deletion";
import { dbError, readBody, reply, requireUser } from "@/lib/account-api";

export const dynamic = "force-dynamic";
const FIELDS = "id, requested_at, due_at";
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function requestJson(r: { requested_at: string; due_at: string }) {
  return { requestedAt: r.requested_at, dueAt: r.due_at, graceDays: DELETION_GRACE_DAYS };
}
function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "بريدك المرتبط بالحساب";
  return `${local.slice(0, 1)}•••@${domain}`;
}
function codeHash(userId: string, code: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is missing");
  return crypto.createHmac("sha256", secret).update(`account-deletion:${userId}:${code}`).digest("hex");
}
async function sendDeletionCode(email: string, code: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "رمز تأكيد حذف حساب EURO",
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#172033"><h2>تأكيد حذف حساب EURO</h2><p>استخدم الرمز التالي لتأكيد طلب حذف حسابك:</p><div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:18px;background:#f2f5f9;text-align:center;border-radius:12px">${code}</div><p>صلاحية الرمز 10 دقائق. إذا لم تطلب حذف الحساب، تجاهل هذه الرسالة.</p></div>`,
      }),
    });
    if (!response.ok) console.error("[account deletion] Resend rejected email:", await response.text());
    return response.ok;
  } catch (error) {
    console.error("[account deletion] email delivery failed:", error);
    return false;
  }
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data, error } = await getSupabaseAdmin().from("account_deletion_requests")
    .select(FIELDS).eq("user_id", auth.user.id).eq("status", "pending").maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return reply({ request: null, ready: false });
    return dbError("deletion status", error, "تعذر قراءة حالة الحذف");
  }
  return reply({ request: data ? requestJson(data) : null, ready: true });
}

/** POST { action: "send-code" } or { action: "confirm-code", code }. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  const action = body?.action;
  const db = getSupabaseAdmin();

  if (action === "send-code") {
    const { data: identity, error: identityError } = await db.from("user_auth_identities")
      .select("email, email_verified").eq("user_id", auth.user.id)
      .eq("email_verified", true).not("email", "is", null).limit(1).maybeSingle();
    if (identityError) return dbError("deletion email lookup", identityError, "تعذر قراءة البريد المرتبط بالحساب");
    const email = typeof identity?.email === "string" ? identity.email.trim() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply({ error: "لا يوجد بريد إلكتروني موثّق مرتبط بحسابك. أضف بريداً موثّقاً قبل طلب الحذف." }, 409);
    }

    const { data: previous, error: previousError } = await db.from("account_deletion_email_codes")
      .select("resend_after").eq("user_id", auth.user.id).maybeSingle();
    if (previousError) return dbError("deletion code rate limit", previousError, "تعذر إرسال الرمز");
    if (previous?.resend_after && new Date(previous.resend_after).getTime() > Date.now()) {
      return reply({ error: "انتظر قليلاً قبل طلب رمز جديد." }, 429);
    }

    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
    const resendAfter = new Date(Date.now() + RESEND_WAIT_MS).toISOString();
    const { error: saveError } = await db.from("account_deletion_email_codes").upsert({
      user_id: auth.user.id, code_hash: codeHash(auth.user.id, code),
      expires_at: expiresAt, resend_after: resendAfter, attempts: 0, created_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (saveError) return dbError("deletion code save", saveError, "تعذر تجهيز رمز التحقق");

    if (!await sendDeletionCode(email, code)) {
      await db.from("account_deletion_email_codes").delete().eq("user_id", auth.user.id);
      return reply({ error: "تعذر إرسال البريد حالياً. تحقق من إعداد خدمة البريد وحاول لاحقاً." }, 503);
    }
    return reply({ ok: true, message: `أرسلنا رمز التحقق إلى ${maskEmail(email)}. الرمز صالح لمدة 10 دقائق.` });
  }

  if (action !== "confirm-code") return reply({ error: "طلب غير صالح" }, 400);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) return reply({ error: "أدخل رمز التحقق المكوّن من 6 أرقام." }, 400);

  const { data: stored, error: codeError } = await db.from("account_deletion_email_codes")
    .select("code_hash, expires_at, attempts").eq("user_id", auth.user.id).maybeSingle();
  if (codeError) return dbError("deletion code lookup", codeError, "تعذر التحقق من الرمز");
  if (!stored || new Date(stored.expires_at).getTime() <= Date.now()) {
    return reply({ error: "انتهت صلاحية الرمز. اطلب رمزاً جديداً." }, 400);
  }
  if (Number(stored.attempts) >= MAX_ATTEMPTS) {
    await db.from("account_deletion_email_codes").delete().eq("user_id", auth.user.id);
    return reply({ error: "تجاوزت عدد المحاولات المسموح. اطلب رمزاً جديداً." }, 429);
  }
  const valid = crypto.timingSafeEqual(Buffer.from(String(stored.code_hash)), Buffer.from(codeHash(auth.user.id, code)));
  if (!valid) {
    const nextAttempts = Number(stored.attempts) + 1;
    await db.from("account_deletion_email_codes").update({ attempts: nextAttempts }).eq("user_id", auth.user.id);
    return reply({ error: `الرمز غير صحيح. المحاولات المتبقية: ${Math.max(0, MAX_ATTEMPTS - nextAttempts)}` }, 400);
  }

  if (Number(auth.user.debt_balance ?? 0) > 0) {
    return reply({ error: "لا يمكن طلب حذف الحساب وعليه رصيد دين. سدّد الرصيد أو تواصل مع الإدارة." }, 409);
  }
  const { count: active, error: activeError } = await db.from("orders").select("id", { count: "exact", head: true })
    .eq("user_id", auth.user.id).in("status", ["pending", "approved", "shipped"]);
  if (activeError) return dbError("deletion orders check", activeError, "تعذر التحقق من الطلبات");
  if ((active ?? 0) > 0) return reply({ error: "لديك طلبات قيد التنفيذ. انتظر اكتمالها أو إلغاءها ثم أعد المحاولة." }, 409);
  if (auth.user.role === "marketer") {
    const { count: owed, error: owedError } = await db.from("marketer_commissions").select("id", { count: "exact", head: true })
      .eq("marketer_id", auth.user.id).in("status", ["held", "available"]);
    if (owedError) return dbError("deletion commissions check", owedError, "تعذر التحقق من العمولات");
    if ((owed ?? 0) > 0) return reply({ error: "لديك عمولات غير مدفوعة. تواصل مع الإدارة لتسويتها قبل حذف الحساب." }, 409);
  }

  const { data: existing, error: existingError } = await db.from("account_deletion_requests").select(FIELDS)
    .eq("user_id", auth.user.id).eq("status", "pending").maybeSingle();
  if (existingError) return dbError("deletion existing", existingError, "تعذر حفظ الطلب");
  if (existing) {
    await db.from("account_deletion_email_codes").delete().eq("user_id", auth.user.id);
    return reply({ ok: true, request: requestJson(existing) });
  }
  const due = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db.from("account_deletion_requests")
    .insert({ user_id: auth.user.id, due_at: due }).select(FIELDS).single();
  if (error?.code === "23505") {
    const { data: again } = await db.from("account_deletion_requests").select(FIELDS)
      .eq("user_id", auth.user.id).eq("status", "pending").maybeSingle();
    if (again) return reply({ ok: true, request: requestJson(again) });
  }
  if (error || !data) return dbError("deletion insert", error, "تعذر حفظ الطلب");
  await db.from("account_deletion_email_codes").delete().eq("user_id", auth.user.id);
  return reply({ ok: true, request: requestJson(data) }, 201);
}

export async function DELETE() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data, error } = await getSupabaseAdmin().from("account_deletion_requests")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("user_id", auth.user.id).eq("status", "pending").gt("due_at", new Date().toISOString())
    .select("id").maybeSingle();
  if (error) return dbError("deletion cancel", error, "تعذر إلغاء الطلب");
  if (!data) return reply({ error: "لا يوجد طلب حذف قابل للإلغاء" }, 404);
  return reply({ ok: true });
}
