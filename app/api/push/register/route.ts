import { NextResponse } from "next/server";
import { requireUser } from "@/lib/account-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createHash } from "node:crypto";
import { notifyUser } from "@/lib/push";
import { readJsonLimited } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireUser({ allowCustomer: true });
  if (!auth.ok) return auth.response;
  try {
    const body = (await readJsonLimited(req, 16 * 1024)) as Record<string, unknown> | null;
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token || token.length > 4096) {
      return NextResponse.json({ error: "رمز الجهاز غير صالح" }, { status: 400 });
    }
    // The apps may send their platform; the table only allows these two values (older app builds send nothing).
    const platform = body?.platform === undefined ? "android" : body.platform;
    if (platform !== "android" && platform !== "ios") {
      return NextResponse.json({ error: "منصة الجهاز غير صالحة" }, { status: 400 });
    }
    const db = getSupabaseAdmin();
    const { data: existingTokens, error: lookupError } = await db.from("push_tokens")
      .select("token").eq("user_id", auth.user.id);
    if (lookupError) {
      console.error("[api/push/register] lookup", lookupError);
      return NextResponse.json({ error: "تعذر التحقق من الجهاز" }, { status: 500 });
    }
    const isNewDevice = (existingTokens ?? []).some((row) => row.token !== token);
    // A device token belongs to the account that is signed in on that device. When the same device signs in with a
    // different account the token moves to it (the previous account stops receiving pushes there). The move is
    // logged (never the token itself) so an account that keeps taking tokens from others can be spotted.
    const { data: owner } = await db.from("push_tokens").select("user_id").eq("token", token).maybeSingle();
    if (owner && String(owner.user_id) !== String(auth.user.id)) {
      console.warn("[api/push/register] token rebound to another account", {
        from: String(owner.user_id).slice(0, 8), to: String(auth.user.id).slice(0, 8),
      });
    }
    const { error } = await db.from("push_tokens").upsert({
      user_id: auth.user.id,
      token,
      platform,
      updated_at: new Date().toISOString(),
    }, { onConflict: "token" });
    if (error) {
      console.error("[api/push/register]", error);
      return NextResponse.json({ error: "تعذر تسجيل الجهاز للإشعارات" }, { status: 500 });
    }
    if (isNewDevice) {
      const tokenFingerprint = createHash("sha256").update(token).digest("hex").slice(0, 32);
      await notifyUser({
        userId: String(auth.user.id),
        type: "security_new_device",
        title: "تسجيل دخول من جهاز جديد",
        body: "تم تسجيل الدخول إلى حسابك من جهاز جديد",
        eventKey: `security:new-device:${tokenFingerprint}`,
        excludeToken: token,
        data: { screen: "account", security: "new_device" },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/push/register]", error);
    return NextResponse.json({ error: "تعذر تسجيل الجهاز للإشعارات" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireUser({ allowCustomer: true });
  if (!auth.ok) return auth.response;
  try {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* query-string token is used by native sign-out */ }
    const queryToken = new URL(req.url).searchParams.get("token");
    const token = typeof body?.token === "string" ? body.token.trim() : (queryToken ?? "").trim();
    if (!token) return NextResponse.json({ ok: true });
    const { error } = await getSupabaseAdmin().from("push_tokens")
      .delete().eq("user_id", auth.user.id).eq("token", token);
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
