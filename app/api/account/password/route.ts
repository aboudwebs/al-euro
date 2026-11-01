import { getSupabaseAdmin } from "@/lib/supabase";
import { hashPassword, safeEqual } from "@/lib/session";
import { readBody, reply, requireUser } from "@/lib/account-api";
import { notifyUser } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Body: { currentPassword, newPassword }. The current password must be right (a stolen session is not enough). */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  const current = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (!current) return reply({ error: "أدخل كلمة المرور الحالية" }, 400);
  if (next.length < 4 || next.length > 128) return reply({ error: "كلمة المرور الجديدة يجب أن تكون بين 4 و128 حرفاً" }, 400);
  if (!safeEqual(String(auth.user.password_hash ?? ""), hashPassword(current))) {
    return reply({ error: "كلمة المرور الحالية غير صحيحة" }, 403);
  }
  const { error } = await getSupabaseAdmin().from("users").update({ password_hash: hashPassword(next) }).eq("id", auth.user.id);
  if (error) {
    console.error("[api/account/password] update:", error);
    return reply({ error: "تعذر تغيير كلمة المرور" }, 500);
  }
  await notifyUser({
    userId: String(auth.user.id),
    type: "security_password_changed",
    title: "تغيير كلمة المرور",
    body: "تم تغيير كلمة المرور بنجاح",
    eventKey: `security:password-changed:${auth.user.id}:${Date.now()}`,
    data: { screen: "account", security: "password_changed" },
  });
  return reply({ ok: true });
}
