import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hmacHex, timingSafeEqualHex } from "@/lib/keys";
import { RULES, dailyOtpCap, rateHit, rateKey } from "@/lib/rate-limit";
import { registrationOtpMessage, sendWhatsAppText, whatsappConfigured } from "@/lib/messaging";

/**
 * WhatsApp proof of phone ownership for sign-up and for linking a Firebase account to a phone number.
 *
 * The earlier version was stateless: the "token" returned to the client held a signature of the code, so a client
 * could test all one million codes offline and use one code any number of times. Now the server keeps the state in
 * public.registration_otp_codes: only a keyed hash of the code is stored; a code expires after 5 minutes, allows 5
 * wrong tries (counted atomically before the comparison), and works once. The `otpToken` the apps already send back is
 * now just the opaque id of that row (no secret in it).
 */

export const REGISTRATION_OTP_TTL_MS = 5 * 60 * 1000;
export const REGISTRATION_OTP_MAX_ATTEMPTS = 5;

/** Registration without phone proof stays off until the operator turns it on (REGISTRATION_OTP_ENABLED=true). */
export function registrationOtpEnabled(): boolean {
  return process.env.REGISTRATION_OTP_ENABLED === "true";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hashRegistrationCode(phone: string, code: string): string {
  return hmacHex("registration-otp-v1", `${phone}:${code}`);
}

export type IssueRegistrationOtp =
  | { ok: true; token: string }
  | { ok: false; reason: "throttled" | "unconfigured" | "undelivered" | "unavailable"; retryAfter?: number };

/** Creates a code for `phone`, sends it on WhatsApp and returns the opaque token for the client. */
export async function issueRegistrationOtp(phone: string, ip: string): Promise<IssueRegistrationOtp> {
  if (!whatsappConfigured()) return { ok: false, reason: "unconfigured" };

  // Flood limits: per phone (1/min, 5/h), per caller address, and a global daily ceiling on messages sent.
  for (const [key, rule] of [
    [rateKey("reg-otp-min", phone), RULES.otpPerPhoneMinute],
    [rateKey("reg-otp-hour", phone), RULES.otpPerPhoneHour],
    [rateKey("reg-otp-ip", ip), RULES.otpPerIpHour],
    ["reg-otp-daily", { limit: dailyOtpCap(), windowSeconds: 24 * 60 * 60, blockSeconds: 60 * 60 }],
  ] as const) {
    const decision = await rateHit(key, rule);
    if (!decision.allowed) return { ok: false, reason: "throttled", retryAfter: decision.retryAfter };
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("registration_otp_codes").insert({
    phone,
    code_hash: hashRegistrationCode(phone, code),
    expires_at: new Date(Date.now() + REGISTRATION_OTP_TTL_MS).toISOString(),
  }).select("id").single();
  if (error || !data) {
    console.error("[registration-otp] store:", error);
    return { ok: false, reason: "unavailable" };
  }

  const sent = await sendWhatsAppText(phone, registrationOtpMessage(code));
  if (!sent) {
    await db.from("registration_otp_codes").delete().eq("id", data.id);
    return { ok: false, reason: "undelivered" };
  }
  return { ok: true, token: String(data.id) };
}

export type OtpClaim =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; reason: "invalid" | "failed" };

/**
 * Verifies the code and marks it used in one step, so two parallel requests cannot both succeed with the same code.
 * Call it immediately before the action it authorises and call `release()` if that action then fails for a reason that
 * is not the user's wrong code (validation error, database error): the code becomes usable again and the correct
 * guess is not counted against the five tries. A wrong code never releases anything.
 */
export async function claimRegistrationOtp(phone: unknown, code: unknown, token: unknown): Promise<OtpClaim> {
  const cleanPhone = typeof phone === "string" ? phone.trim() : "";
  const submitted = typeof code === "string" ? code.trim() : "";
  const id = typeof token === "string" ? token.trim() : "";
  if (!cleanPhone || !/^\d{6}$/.test(submitted) || !UUID_RE.test(id)) return { ok: false, reason: "invalid" };

  const db = getSupabaseAdmin();
  const { data: row, error } = await db.from("registration_otp_codes")
    .select("id, code_hash, attempts").eq("id", id).eq("phone", cleanPhone)
    .is("used_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) {
    console.error("[registration-otp] lookup:", error);
    return { ok: false, reason: "failed" };
  }
  if (!row || Number(row.attempts) >= REGISTRATION_OTP_MAX_ATTEMPTS) return { ok: false, reason: "invalid" };

  // Burn one try first (compare-and-set on `attempts`): parallel guesses cannot exceed the limit.
  const attempts = Number(row.attempts);
  const { data: burned, error: burnError } = await db.from("registration_otp_codes")
    .update({ attempts: attempts + 1 }).eq("id", id).eq("attempts", attempts).select("id").maybeSingle();
  if (burnError) {
    console.error("[registration-otp] attempt update:", burnError);
    return { ok: false, reason: "failed" };
  }
  if (!burned) return { ok: false, reason: "invalid" };
  if (!timingSafeEqualHex(String(row.code_hash), hashRegistrationCode(cleanPhone, submitted))) return { ok: false, reason: "invalid" };

  const { data: used, error: useError } = await db.from("registration_otp_codes")
    .update({ used_at: new Date().toISOString() }).eq("id", id).is("used_at", null).select("id").maybeSingle();
  if (useError) {
    console.error("[registration-otp] mark used:", useError);
    return { ok: false, reason: "failed" };
  }
  if (!used) return { ok: false, reason: "invalid" };

  return {
    ok: true,
    release: async () => {
      const { error: releaseError } = await db.from("registration_otp_codes")
        .update({ used_at: null, attempts }).eq("id", id);
      if (releaseError) console.error("[registration-otp] release:", releaseError);
    },
  };
}
