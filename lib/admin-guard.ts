import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";

export type AdminContext = { id: string; name: string; phone: string };

type GuardResult =
  | { ok: true; admin: AdminContext }
  | { ok: false; response: NextResponse };

function deny(error: string, status: number): GuardResult {
  return { ok: false, response: NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } }) };
}

/**
 * Server-side admin check for every /api/admin/* route. The signed cookie alone is not enough:
 * the user row is re-read so a suspended or demoted admin loses access immediately.
 *
 *   const guard = await requireAdmin();
 *   if (!guard.ok) return guard.response;
 */
export async function requireAdmin(): Promise<GuardResult> {
  let session: ReturnType<typeof getSession>;
  try {
    session = getSession();
  } catch {
    return deny("إعداد الخادم غير مكتمل", 500);
  }
  if (!session) return deny("يرجى تسجيل الدخول", 401);
  if (session.role !== "admin") return deny("غير مصرح: هذه العملية للإدارة فقط", 403);

  const { data: user, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, name, phone, role, is_active")
    .eq("id", session.id)
    .maybeSingle();

  if (error) {
    console.error("[admin-guard] user lookup:", error);
    return deny("تعذر التحقق من الصلاحيات", 500);
  }
  if (!user || user.role !== "admin" || !user.is_active) return deny("غير مصرح: هذه العملية للإدارة فقط", 403);

  return { ok: true, admin: { id: String(user.id), name: user.name, phone: user.phone } };
}
