import { getSupabaseAdmin } from "@/lib/supabase";
import { hmacHex } from "@/lib/keys";
import { RULES, rateHit, rateKey } from "@/lib/rate-limit";
import { referralFlags } from "@/lib/referral-rules";

/**
 * Referral abuse controls. They never change who may sign up or when a marketer is activated: the first one slows down
 * code guessing, the second one only RECORDS signups and raises flags for the admin to review
 * (GET /api/admin/referral-flags). Everything here is best effort: a failure is logged and the sign-up carries on.
 */

/** Slows down enumeration of marketer codes: each unknown or inactive code counts against the caller's address. */
export async function referralLookupAllowed(ip: string): Promise<{ allowed: boolean; retryAfter: number }> {
  return rateHit(rateKey("referral-lookup-ip", ip), RULES.referralLookupPerIp, { increment: false });
}

export async function referralLookupFailed(ip: string): Promise<void> {
  await rateHit(rateKey("referral-lookup-ip", ip), RULES.referralLookupPerIp);
}

function ipHash(ip: string): string {
  return hmacHex("referral-ip-v1", ip).slice(0, 32);
}

/**
 * Stores one row per referred signup (hashed caller address only, no raw IP) and flags suspicious patterns:
 * the referred phone equals the marketer's own phone, five or more signups for one marketer within an hour, or three
 * or more from the same address within a day.
 */
export async function recordReferralSignup(input: { newUserId: string; newUserPhone: string; referralCode: string; ip: string }): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    const { data: marketer } = await db.from("users").select("id, phone")
      .eq("role", "marketer").eq("my_ref_code", input.referralCode).maybeSingle();
    if (!marketer) return;

    const address = ipHash(input.ip);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ count: lastHour }, { count: sameAddress }] = await Promise.all([
      db.from("referral_signups").select("id", { count: "exact", head: true }).eq("marketer_id", marketer.id).gte("created_at", hourAgo),
      db.from("referral_signups").select("id", { count: "exact", head: true }).eq("ip_hash", address).gte("created_at", dayAgo),
    ]);

    const { error } = await db.from("referral_signups").insert({
      marketer_id: marketer.id, referred_user_id: input.newUserId, referral_code: input.referralCode, ip_hash: address,
    });
    if (error) {
      console.error("[referral-guard] record signup (apply the referral migration):", error.code);
      return;
    }
    // This signup counts too, hence +1.
    const flags = referralFlags({
      newUserPhone: input.newUserPhone,
      referrerPhone: marketer.phone ? String(marketer.phone) : null,
      signupsLastHour: (lastHour ?? 0) + 1,
      signupsSameAddressLastDay: (sameAddress ?? 0) + 1,
    });
    if (flags.length) {
      const { error: flagError } = await db.from("referral_flags").insert(flags.map((flag) => ({
        marketer_id: marketer.id, referred_user_id: input.newUserId, reason: flag,
      })));
      if (flagError) console.error("[referral-guard] record flags:", flagError.code);
    }
  } catch (err) {
    console.error("[referral-guard] unexpected:", err);
  }
}
