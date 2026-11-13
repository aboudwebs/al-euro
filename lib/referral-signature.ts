import crypto from "crypto";
import { hmacHex, timingSafeEqualHex } from "@/lib/keys";

/** Signature of a marketer's referral code, embedded in the invitation link (derived key, purpose "referral-v1"). */
export function signReferralCode(code: string): string {
  return hmacHex("referral-v1", `workshop-referral:${code}`);
}

/**
 * Accepts the new signature and, for links that were already shared, the old one (HMAC keyed directly with
 * AUTH_SECRET). The legacy branch can be removed once no old invitation link is in circulation.
 */
export function verifyReferralSignature(code: string, signature: string): boolean {
  if (!code || !signature) return false;
  if (timingSafeEqualHex(signReferralCode(code), signature)) return true;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  const legacy = crypto.createHmac("sha256", secret).update(`workshop-referral:${code}`).digest("hex");
  return timingSafeEqualHex(legacy, signature);
}
