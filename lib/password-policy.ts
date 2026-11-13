/**
 * New passwords (sign-up, change, reset) need at least 8 characters. Sign-in is NOT subject to this minimum, so accounts
 * created under the earlier 4-character rule can still log in (and are asked to choose a stronger password when they
 * change it). Pure module: no imports.
 */
export const MIN_NEW_PASSWORD = 8;
export const MAX_PASSWORD = 128;

export function newPasswordError(password: unknown): string | null {
  if (typeof password !== "string") return "كلمة المرور غير صالحة";
  if (password.length < MIN_NEW_PASSWORD) return `كلمة المرور يجب أن تكون ${MIN_NEW_PASSWORD} أحرف على الأقل`;
  if (password.length > MAX_PASSWORD) return `كلمة المرور يجب ألا تتجاوز ${MAX_PASSWORD} حرفاً`;
  return null;
}
