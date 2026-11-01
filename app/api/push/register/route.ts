import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: "يرجى تسجيل الدخول" }, { status: 401 });
  try {
    const body = await req.json();
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token || token.length > 4096) {
      return NextResponse.json({ error: "رمز الجهاز غير صالح" }, { status: 400 });
    }
    const { error } = await getSupabaseAdmin().from("push_tokens").upsert({
      user_id: session.id,
      token,
      platform: "android",
      updated_at: new Date().toISOString(),
    }, { onConflict: "token" });
    if (error) {
      console.error("[api/push/register]", error);
      return NextResponse.json({ error: "تعذر تسجيل الجهاز للإشعارات" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/push/register]", error);
    return NextResponse.json({ error: "تعذر تسجيل الجهاز للإشعارات" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: "يرجى تسجيل الدخول" }, { status: 401 });
  try {
    const body = await req.json();
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) return NextResponse.json({ ok: true });
    const { error } = await getSupabaseAdmin().from("push_tokens")
      .delete().eq("user_id", session.id).eq("token", token);
    if (error) {
      console.error("[api/push/register] delete", error);
      return NextResponse.json({ error: "تعذر إلغاء تسجيل الجهاز" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/push/register] delete", error);
    return NextResponse.json({ error: "تعذر إلغاء تسجيل الجهاز" }, { status: 500 });
  }
}
