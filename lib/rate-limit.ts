import crypto from "crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { MemoryRateLimiter, type RateDecision, type RateRule } from "@/lib/rate-limit-core";
import { deriveKey } from "@/lib/keys";

export type { RateRule, RateDecision } from "@/lib/rate-limit-core";

/**
 * Brute-force and flooding protection for sign-in, registration, one-time codes and recovery.
 *
 * The counters live in public.auth_rate_limits (shared by every server instance, survives restarts) and are updated by
 * the atomic SQL function public.auth_rate_hit(). When the database store is unavailable (function not created yet,
 * network error) the limiter does NOT switch itself off: it falls back to an in-process counter with the same rule and
 * logs the failure loudly. Protection is then per instance, never absent.
 */

const memory = new MemoryRateLimiter();
let lastStoreWarning = 0;

function warnStoreFailure(err: unknown) {
  const now = Date.now();
  if (now - lastStoreWarning < 60_000) return;
  lastStoreWarning = now;
  console.error("[rate-limit] database store unavailable, using in-process counters (apply the auth_rate_limits migration):", err);
}

/** Hashes the identifying parts (phone, IP) so no personal data is stored in the counter table. */
export function rateKey(scope: string, ...parts: string[]): string {
  let digest: string;
  try {
    digest = crypto.createHmac("sha256", deriveKey("rate-key-v1")).update(parts.join("|")).digest("hex");
  } catch {
    digest = crypto.createHash("sha256").update(parts.join("|")).digest("hex");
  }
  return `${scope}:${digest.slice(0, 32)}`;
}

export async function rateHit(key: string, rule: RateRule, options: { increment?: boolean } = {}): Promise<RateDecision> {
  const increment = options.increment !== false;
  try {
    const { data, error } = await getSupabaseAdmin().rpc("auth_rate_hit", {
      p_key: key,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
      p_block_seconds: rule.blockSeconds,
      p_increment: increment,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") throw new Error("unexpected auth_rate_hit result");
    return { allowed: row.allowed, retryAfter: Number(row.retry_after) || 0 };
  } catch (err) {
    warnStoreFailure(err);
    return memory.hit(key, rule, increment);
  }
}

/** Clears a key after a successful sign-in. */
export async function rateReset(key: string): Promise<void> {
  memory.reset(key);
  try {
    const { error } = await getSupabaseAdmin().rpc("auth_rate_reset", { p_key: key });
    if (error) throw error;
  } catch (err) {
    warnStoreFailure(err);
  }
}

/** Runs several limits in order and stops at the first one that refuses. */
export async function rateHitAll(checks: Array<{ key: string; rule: RateRule; increment?: boolean }>): Promise<RateDecision> {
  let worst: RateDecision = { allowed: true, retryAfter: 0 };
  for (const check of checks) {
    const decision = await rateHit(check.key, check.rule, { increment: check.increment });
    if (!decision.allowed) {
      worst = decision;
      break;
    }
  }
  return worst;
}

export function tooManyRequests(retryAfterSeconds: number): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds || 60));
  const minutes = Math.ceil(seconds / 60);
  const wait = seconds < 60 ? `${seconds} ثانية` : `${minutes} دقيقة`;
  return NextResponse.json(
    { error: `محاولات كثيرة. حاول مجدداً بعد ${wait}.`, retryAfter: seconds },
    { status: 429, headers: { "Retry-After": String(seconds), "Cache-Control": "no-store" } },
  );
}

/** Shared rules, kept in one place so every route applies the same numbers. */
export const RULES = {
  loginFailPerAccount: { limit: 5, windowSeconds: 15 * 60, blockSeconds: 15 * 60 } as RateRule,
  loginPerIp: { limit: 30, windowSeconds: 10 * 60, blockSeconds: 10 * 60 } as RateRule,
  registerPerIp: { limit: 10, windowSeconds: 60 * 60, blockSeconds: 60 * 60 } as RateRule,
  otpPerPhoneMinute: { limit: 1, windowSeconds: 60, blockSeconds: 60 } as RateRule,
  otpPerPhoneHour: { limit: 5, windowSeconds: 60 * 60, blockSeconds: 60 * 60 } as RateRule,
  otpPerIpHour: { limit: 10, windowSeconds: 60 * 60, blockSeconds: 60 * 60 } as RateRule,
  otpVerifyPerIp: { limit: 30, windowSeconds: 10 * 60, blockSeconds: 10 * 60 } as RateRule,
  recoveryPerIp: { limit: 10, windowSeconds: 60 * 60, blockSeconds: 60 * 60 } as RateRule,
  adminResetPerIp: { limit: 5, windowSeconds: 15 * 60, blockSeconds: 60 * 60 } as RateRule,
  referralLookupPerIp: { limit: 30, windowSeconds: 60 * 60, blockSeconds: 60 * 60 } as RateRule,
  twoFactorPerAccount: { limit: 5, windowSeconds: 10 * 60, blockSeconds: 15 * 60 } as RateRule,
};

export function dailyOtpCap(): number {
  const value = Number(process.env.OTP_DAILY_CAP);
  return Number.isInteger(value) && value > 0 ? value : 500;
}

/** One shared ceiling on SMS codes sent per day (all purposes), so a flood can never run up the SMS bill. */
export async function smsDailyBudget(): Promise<RateDecision> {
  return rateHit("sms-otp-daily", { limit: dailyOtpCap(), windowSeconds: 24 * 60 * 60, blockSeconds: 60 * 60 });
}
