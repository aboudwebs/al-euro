import { NextResponse } from "next/server";
import { SessionStoreError, bumpTokenVersion, clearSession, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * "Sign out of all devices": raises the account's token version, so every token issued so far (browser cookies and the
 * apps' Bearer tokens, including a stolen copy) stops working. The caller is signed out too and signs in again.
 */
export async function POST() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "يرجى تسجيل الدخول" }, { status: 401, headers });
    const version = await bumpTokenVersion(session.id);
    await clearSession();
    if (version === null) {
      // The token_version column does not exist yet: nothing could be revoked, so say so instead of pretending.
      return NextResponse.json({ error: "الميزة غير مفعّلة بعد على الخادم (تحتاج تحديث قاعدة البيانات)." }, { status: 503, headers });
    }
    return NextResponse.json({ ok: true }, { headers });
  } catch (err) {
    console.error("[api/auth/logout-all]", err);
    if (err instanceof SessionStoreError) return NextResponse.json({ error: "الخدمة غير متاحة مؤقتاً" }, { status: 503, headers });
    return NextResponse.json({ error: "حدث خطأ غير متوقع في الخادم" }, { status: 500, headers });
  }
}
