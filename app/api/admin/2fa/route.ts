import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { verifyPassword } from "@/lib/session";
import { RULES, rateHit, rateKey, rateReset, tooManyRequests } from "@/lib/rate-limit";
import { readJsonLimited } from "@/lib/http";
import { generateRecoveryCodes, generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import {
  checkSecondFactor, emergencyBypass, readTwoFactorState, recoveryHash, sealTotpSecret,
} from "@/lib/admin-2fa";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_READY = "الميزة غير مفعّلة بعد على الخادم (تحتاج تحديث قاعدة البيانات).";

/**
 * Two-step verification (authenticator app) for the signed-in administrator. It protects the production account only
 * once this admin finishes the enrolment below: until then sign-in is unchanged.
 *
 *   GET                               -> { enrolled, available, emergencyBypass }
 *   POST { action: "begin" }          -> a new secret + otpauth link (not active yet)
 *   POST { action: "confirm", code }  -> the code from the app activates it; returns 8 one-time recovery codes (shown once)
 *   POST { action: "disable", password, code }  -> turns it off (needs the password and a valid app / recovery code)
 */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    const state = await readTwoFactorState(guard.admin.id);
    return json({ enrolled: state.enrolled, available: !state.unavailable, emergencyBypass: emergencyBypass() });
  } catch (err) {
    console.error("[api/admin/2fa] GET:", err);
    return json({ error: "تعذر قراءة حالة التحقق بخطوتين" }, 500);
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const adminId = guard.admin.id;
  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await readJsonLimited(req, 8 * 1024);
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return json({ error: "بيانات الطلب غير صالحة" }, 400);
    }
    const db = getSupabaseAdmin();
    const state = await readTwoFactorState(adminId);
    if (state.unavailable) return json({ error: NOT_READY, code: "not_ready" }, 503);

    if (body.action === "begin") {
      if (state.enrolled) return json({ error: "التحقق بخطوتين مفعّل بالفعل." }, 409);
      const secret = generateTotpSecret();
      const { error } = await db.from("users").update({ totp_secret_enc: sealTotpSecret(secret), totp_enabled_at: null }).eq("id", adminId);
      if (error) throw error;
      return json({ secret, otpauthUri: otpauthUri(guard.admin.phone || guard.admin.name, secret) });
    }

    if (body.action === "confirm") {
      if (state.enrolled || !state.pendingSecret) return json({ error: "ابدأ الإعداد أولاً." }, 409);
      const key = rateKey("admin-2fa-setup", adminId);
      const blocked = await rateHit(key, RULES.twoFactorPerAccount, { increment: false });
      if (!blocked.allowed) return tooManyRequests(blocked.retryAfter);
      const step = verifyTotp(state.pendingSecret, typeof body.code === "string" ? body.code : "");
      if (step === null) {
        const after = await rateHit(key, RULES.twoFactorPerAccount);
        return after.allowed ? json({ error: "الرمز غير صحيح. تأكد من وقت الهاتف وأعد المحاولة." }, 400) : tooManyRequests(after.retryAfter);
      }
      const codes = generateRecoveryCodes();
      await db.from("admin_recovery_codes").delete().eq("user_id", adminId);
      const { error: codesError } = await db.from("admin_recovery_codes")
        .insert(codes.map((code) => ({ user_id: adminId, code_hash: recoveryHash(adminId, code) })));
      if (codesError) throw codesError;
      const { error } = await db.from("users")
        .update({ totp_enabled_at: new Date().toISOString(), totp_last_step: step }).eq("id", adminId);
      if (error) throw error;
      await rateReset(key);
      return json({ ok: true, recoveryCodes: codes });
    }

    if (body.action === "disable") {
      if (!state.enrolled) return json({ error: "التحقق بخطوتين غير مفعّل." }, 409);
      const { data: row } = await db.from("users").select("password_hash").eq("id", adminId).maybeSingle();
      const password = typeof body.password === "string" ? body.password : "";
      if (!row?.password_hash || !password || !verifyPassword(String(row.password_hash), password)) {
        const key = rateKey("admin-2fa-disable", adminId);
        const after = await rateHit(key, RULES.twoFactorPerAccount);
        return after.allowed ? json({ error: "كلمة المرور غير صحيحة." }, 403) : tooManyRequests(after.retryAfter);
      }
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const second = await checkSecondFactor(adminId, "admin", /^\d{6}$/.test(code.replace(/\s+/g, ""))
        ? { totpCode: code } : { recoveryCode: code });
      if (second.status === "limited") return tooManyRequests(second.retryAfter);
      if (second.status !== "ok") return json({ error: "رمز التحقق غير صحيح." }, 403);
      const { error } = await db.from("users").update({ totp_secret_enc: null, totp_enabled_at: null, totp_last_step: 0 }).eq("id", adminId);
      if (error) throw error;
      await db.from("admin_recovery_codes").delete().eq("user_id", adminId);
      return json({ ok: true });
    }

    return json({ error: "طلب غير صالح" }, 400);
  } catch (err) {
    console.error("[api/admin/2fa] POST:", err);
    return json({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
  }
}
