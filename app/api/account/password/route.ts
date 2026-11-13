import { getSupabaseAdmin } from "@/lib/supabase";
import { bumpTokenVersion, hashPassword, setSession, verifyPassword } from "@/lib/session";
import { readBody, reply, requireUser } from "@/lib/account-api";
import { newPasswordError } from "@/lib/password-policy";
import { RULES, rateHit, rateKey, rateReset, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Body: { currentPassword, newPassword }. The current password must be right (a stolen session is not enough), wrong
 * guesses are limited, and a successful change signs the account out everywhere else: every token issued before is
 * revoked and this device receives a new one (`accessToken`, also set as the cookie).
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  const current = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (!current) return reply({ error: "أدخل كلمة المرور الحالية" }, 400);
  const policyError = newPasswordError(next);
  if (policyError) return reply({ error: policyError }, 400);

  const key = rateKey("password-change", auth.user.id);
  const blocked = await rateHit(key, RULES.loginFailPerAccount, { increment: false });
  if (!blocked.allowed) return tooManyRequests(blocked.retryAfter);
  if (!verifyPassword(String(auth.user.password_hash ?? ""), current)) {
    const after = await rateHit(key, RULES.loginFailPerAccount);
    return after.allowed ? reply({ error: "كلمة المرور الحالية غير صحيحة" }, 403) : tooManyRequests(after.retryAfter);
  }
  await rateReset(key);

  const { error } = await getSupabaseAdmin().from("users").update({ password_hash: hashPassword(next) }).eq("id", auth.user.id);
  if (error) {
    console.error("[api/account/password] update:", error);
    return reply({ error: "تعذر تغيير كلمة المرور" }, 500);
  }
  try {
    await bumpTokenVersion(auth.user.id);
  } catch (err) {
    console.error("[api/account/password] revoke sessions:", err);
  }
  const accessToken = await setSession({
    id: auth.user.id, role: auth.user.role, name: auth.user.name ?? "", phone: auth.user.phone ?? "",
  });
  return reply({ ok: true, accessToken });
}
