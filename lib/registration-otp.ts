import crypto from "crypto";
import { getSecret, safeEqual } from "@/lib/session";

/** Validates the short-lived phone-bound OTP token issued by POST /api/auth (send-otp). */
export function verifyRegistrationOtp(phone: unknown, code: unknown, token: unknown): boolean {
  const cleanPhone = typeof phone === "string" ? phone.trim() : "";
  const submittedCode = typeof code === "string" ? code.trim() : "";
  const encodedToken = typeof token === "string" ? token : "";
  if (!cleanPhone || !/^\\d{6}$/.test(submittedCode) || !encodedToken || encodedToken.length > 2048) return false;

  try {
    const decoded = JSON.parse(Buffer.from(encodedToken, "base64").toString("utf-8"));
    if (decoded.p !== cleanPhone || typeof decoded.e !== "number" ||
        !Number.isFinite(decoded.e) || decoded.e <= Date.now() ||
        decoded.e > Date.now() + 5 * 60 * 1000 || typeof decoded.s !== "string") return false;
    const expected = crypto.createHmac("sha256", getSecret())
      .update(`${cleanPhone}:${decoded.e}:${submittedCode}`).digest("hex");
    return safeEqual(expected, decoded.s);
  } catch {
    return false;
  }
}
