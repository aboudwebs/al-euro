import { getSupabaseAdmin } from "@/lib/supabase";
import { deriveKey, hmacHex, timingSafeEqualHex } from "@/lib/keys";
import { openSecret, sealSecret, verifyTotp } from "@/lib/totp";
import { RULES, rateHit, rateKey, rateReset } from "@/lib/rate-limit";

/**
 * Optional two-step verification for admin accounts (TOTP app + one-time recovery codes).
 * It is enforced for an account only after that admin has finished enrolment, so deploying the code changes nothing
 * for production admins until they switch it on from /admin/security. ADMIN_2FA_DISABLED=true is the emergency switch
 * that skips the check (for a lost phone) and must be removed again afterwards.
 */

function encryptionKey(): Buffer {
  const configured = process.env.TOTP_ENC_KEY;
  if (configured) {
    const raw = Buffer.from(configured, "base64");
    if (raw.length === 32) return raw;
    console.error("[admin-2fa] TOTP_ENC_KEY must be 32 bytes in base64; using the derived key instead");
  }
  return deriveKey("totp-encryption-v1");
}

export function emergencyBypass(): boolean {
  return process.env.ADMIN_2FA_DISABLED === "true";
}

export function sealTotpSecret(secret: string): string {
  return sealSecret(secret, encryptionKey());
}

export function openTotpSecret(sealed: string): string {
  return openSecret(sealed, encryptionKey());
}

export function recoveryHash(userId: string, code: string): string {
  return hmacHex("admin-recovery-v1", `${userId}:${code.trim().toLowerCase()}`);
}

export type TwoFactorState = { enrolled: boolean; secret: string | null; pendingSecret: string | null; unavailable: boolean; lastStep: number };

/** Reads the admin's 2FA columns. A missing column/table means the migration is not applied: nobody is enrolled. */
export async function readTwoFactorState(userId: string): Promise<TwoFactorState> {
  const { data, error } = await getSupabaseAdmin().from("users")
    .select("totp_secret_enc, totp_enabled_at, totp_last_step").eq("id", userId).maybeSingle();
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") return { enrolled: false, secret: null, pendingSecret: null, unavailable: true, lastStep: 0 };
    console.error("[admin-2fa] state lookup:", error);
    throw error;
  }
  const sealed = typeof data?.totp_secret_enc === "string" ? data.totp_secret_enc : null;
  const enrolled = Boolean(data?.totp_enabled_at && sealed);
  return {
    enrolled,
    secret: enrolled && sealed ? openTotpSecret(sealed) : null,
    pendingSecret: !enrolled && sealed ? openTotpSecret(sealed) : null,
    unavailable: false,
    lastStep: Number.isFinite(Number(data?.totp_last_step)) ? Number(data?.totp_last_step) : 0,
  };
}

/** Consumes a recovery code (single use). Returns true when one matched. */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  const hash = recoveryHash(userId, code);
  const { data, error } = await db.from("admin_recovery_codes")
    .select("id, code_hash").eq("user_id", userId).is("used_at", null);
  if (error) {
    console.error("[admin-2fa] recovery lookup:", error);
    return false;
  }
  const match = (data ?? []).find((row) => timingSafeEqualHex(String(row.code_hash), hash));
  if (!match) return false;
  const { data: used } = await db.from("admin_recovery_codes")
    .update({ used_at: new Date().toISOString() }).eq("id", match.id).is("used_at", null).select("id").maybeSingle();
  return Boolean(used);
}

/**
 * Accepts a TOTP code once: a code whose 30-second step was already used (or an older one) is refused, so a code that
 * was seen over a shoulder or replayed cannot be used again. Returns true when the code was valid and is now spent.
 */
export async function spendTotp(userId: string, secret: string, code: string, lastStep: number): Promise<boolean> {
  const step = verifyTotp(secret, code);
  if (step === null || step <= lastStep) return false;
  const { data } = await getSupabaseAdmin().from("users")
    .update({ totp_last_step: step }).eq("id", userId).lt("totp_last_step", step).select("id").maybeSingle();
  return Boolean(data);
}

export type SecondFactor =
  | { status: "not_required" | "ok" }
  | { status: "required" | "invalid" }
  | { status: "limited"; retryAfter: number };

/**
 * Second step of an admin sign-in (the password was already verified). Admins who have not enrolled are not asked,
 * and the emergency switch ADMIN_2FA_DISABLED=true skips the step. Wrong codes count against a per-account limit.
 */
export async function checkSecondFactor(userId: string, role: string, input: { totpCode?: unknown; recoveryCode?: unknown }): Promise<SecondFactor> {
  if (role !== "admin" || emergencyBypass()) return { status: "not_required" };
  const state = await readTwoFactorState(userId);
  if (!state.enrolled || !state.secret) return { status: "not_required" };

  const totp = typeof input.totpCode === "string" ? input.totpCode.trim() : "";
  const recovery = typeof input.recoveryCode === "string" ? input.recoveryCode.trim() : "";
  if (!totp && !recovery) return { status: "required" };

  const key = rateKey("admin-2fa", userId);
  const blocked = await rateHit(key, RULES.twoFactorPerAccount, { increment: false });
  if (!blocked.allowed) return { status: "limited", retryAfter: blocked.retryAfter };

  const ok = totp ? await spendTotp(userId, state.secret, totp, state.lastStep) : await consumeRecoveryCode(userId, recovery);
  if (!ok) {
    const after = await rateHit(key, RULES.twoFactorPerAccount);
    return after.allowed ? { status: "invalid" } : { status: "limited", retryAfter: after.retryAfter };
  }
  await rateReset(key);
  return { status: "ok" };
}
