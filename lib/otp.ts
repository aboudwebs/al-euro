import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSecret, safeEqual } from "@/lib/session";
import { hmacHex, timingSafeEqualHex } from "@/lib/keys";

// Sending moved to lib/messaging.ts; re-exported so existing imports keep working.
export { sendWhatsAppText, whatsappChatId, whatsappConfigured } from "@/lib/messaging";

/**
 * One-time codes for password recovery and phone change.
 * Unlike the registration token of /api/auth (which carries the code inside the token), the code is never sent
 * to the client: only a keyed hash is stored in public.account_otp_codes, with an expiry and a limit of wrong tries.
 */

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
/** At most this many codes per account and purpose per hour, and one per minute. */
export const OTP_MAX_PER_HOUR = 5;
export const OTP_MIN_GAP_MS = 60 * 1000;

export type OtpPurpose = "password_reset" | "phone_change";

export function generateCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/** Keyed hash with a purpose-bound sub-key of AUTH_SECRET (see lib/keys.ts). */
export function hashCode(purpose: OtpPurpose, userId: string, target: string, code: string): string {
  return hmacHex("otp-v1", `otp:${purpose}:${userId}:${target}:${code}`);
}

/** Hash format used before sub-keys existed; codes issued just before a deployment (10 minute TTL) still verify. */
function legacyHashCode(purpose: OtpPurpose, userId: string, target: string, code: string): string {
  return crypto.createHmac("sha256", getSecret()).update(`otp:${purpose}:${userId}:${target}:${code}`).digest("hex");
}

export function codeMatches(storedHash: string, purpose: OtpPurpose, userId: string, target: string, code: string): boolean {
  return timingSafeEqualHex(storedHash, hashCode(purpose, userId, target, code)) ||
    safeEqual(storedHash, legacyHashCode(purpose, userId, target, code));
}

export function otpMessage(purpose: OtpPurpose, code: string): string {
  const what = purpose === "password_reset" ? "استعادة كلمة المرور" : "تأكيد رقم الموبايل الجديد";
  return `رمز ${what} في EURO CARS هو: *${code}*\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.`;
}

type PgError = { code?: string; message?: string } | null | undefined;

export type IssueResult =
  | { ok: true; code: string; id: string }
  | { ok: false; reason: "throttled" | "failed"; error?: PgError };

/**
 * Creates a fresh code for (account, purpose, target) and stores only its hash. `target` is the phone number the code
 * is bound to (the account's own phone for a password reset, the NEW phone for a phone change).
 * Refuses when a code was issued less than a minute ago or five were issued in the last hour.
 */
export async function issueOtp(userId: string, purpose: OtpPurpose, target: string): Promise<IssueResult> {
  const db = getSupabaseAdmin();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recent, error } = await db
    .from("account_otp_codes")
    .select("created_at")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .gte("created_at", hourAgo)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, reason: "failed", error };
  if ((recent?.length ?? 0) >= OTP_MAX_PER_HOUR) return { ok: false, reason: "throttled" };
  const last = recent?.[0]?.created_at;
  if (last && Date.now() - new Date(last).getTime() < OTP_MIN_GAP_MS) return { ok: false, reason: "throttled" };

  const code = generateCode();
  const { data, error: insertError } = await db
    .from("account_otp_codes")
    .insert({
      user_id: userId,
      purpose,
      target,
      code_hash: hashCode(purpose, userId, target, code),
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (insertError || !data) return { ok: false, reason: "failed", error: insertError };
  return { ok: true, code, id: String(data.id) };
}

/** Forgets a code that could not be delivered, so the one-per-minute limit does not punish the user for a failed send. */
export async function dropOtp(id: string): Promise<void> {
  await getSupabaseAdmin().from("account_otp_codes").delete().eq("id", id);
}

export type ConsumeResult = "ok" | "invalid" | "failed";

/**
 * Checks `code` against the newest unused, unexpired code of (account, purpose, target).
 * Every check burns one of the five tries FIRST (a compare-and-set on `attempts`, so parallel guesses cannot beat the
 * limit), and a correct code is marked used so it works once.
 */
export async function consumeOtp(userId: string, purpose: OtpPurpose, target: string, code: string): Promise<ConsumeResult> {
  const db = getSupabaseAdmin();
  const { data: row, error } = await db
    .from("account_otp_codes")
    .select("id, code_hash, attempts")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .eq("target", target)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[otp] lookup:", error);
    return "failed";
  }
  if (!row || Number(row.attempts) >= OTP_MAX_ATTEMPTS) return "invalid";

  const { data: burned, error: burnError } = await db
    .from("account_otp_codes")
    .update({ attempts: Number(row.attempts) + 1 })
    .eq("id", row.id)
    .eq("attempts", row.attempts)
    .select("id")
    .maybeSingle();
  if (burnError) {
    console.error("[otp] attempt update:", burnError);
    return "failed";
  }
  if (!burned) return "invalid";
  if (!codeMatches(String(row.code_hash), purpose, userId, target, code)) return "invalid";

  const { data: used, error: useError } = await db
    .from("account_otp_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (useError) {
    console.error("[otp] mark used:", useError);
    return "failed";
  }
  return used ? "ok" : "invalid";
}
