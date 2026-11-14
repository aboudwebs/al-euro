/** Pure rules for the one-off administrator password reset (no imports, so they can be unit-tested). */

export const RESET_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RESET_MIN_TOKEN_LENGTH = 32;

export type ResetEnv = { token?: string; expiresAt?: string };

/**
 * The reset is open only while BOTH are set: a token of 32+ characters and an expiry (ISO date) that is in the future
 * and at most 24 hours away. A token left in the environment by mistake therefore stops working by itself.
 */
export function resetWindow(env: ResetEnv, nowMs: number): "open" | "disabled" | "expired" {
  if (!env.token || env.token.length < RESET_MIN_TOKEN_LENGTH) return "disabled";
  if (!env.expiresAt) return "disabled";
  const expires = Date.parse(env.expiresAt);
  if (!Number.isFinite(expires)) return "disabled";
  if (expires <= nowMs) return "expired";
  if (expires - nowMs > RESET_MAX_WINDOW_MS) return "disabled";
  return "open";
}
