import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: "يرجى تسجيل الدخول" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().from("user_notifications")
    .select("id,type,title,body,order_id,read_at,created_at")
    .eq("user_id", session.id).order("created_at", { ascending: false }).limit(50);
  if (error) {
    console.error("[api/notifications]", error);
    return NextResponse.json({ error: "تعذر تحميل الإشعارات" }, { status: 500 });
  }
  return NextResponse.json({ notifications: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: "يرجى تسجيل الدخول" }, { status: 401 });
  const { error } = await getSupabaseAdmin().from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", session.id).is("read_at", null);
  if (error) {
    console.error("[api/notifications] mark read", error);
    return NextResponse.json({ error: "تعذر تحديث الإشعارات" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
