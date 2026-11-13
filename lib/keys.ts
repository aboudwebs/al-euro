import crypto from "crypto";

/**
 * Purpose-bound sub-keys derived from AUTH_SECRET with HKDF-SHA256.
 * Session tokens still use AUTH_SECRET itself (changing that would sign every user out); everything else
 * (OTP hashes, referral signatures, rate-limit keys, TOTP encryption) uses its own derived key, so a signature made
 * for one purpose can never be replayed as another.
 */
export function deriveKey(label: string): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not defined in environment variables");
  return Buffer.from(crypto.hkdfSync("sha256", secret, "euro-key-derivation-v1", label, 32));
}

export function hmacHex(label: string, data: string): string {
  return crypto.createHmac("sha256", deriveKey(label)).update(data).digest("hex");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
