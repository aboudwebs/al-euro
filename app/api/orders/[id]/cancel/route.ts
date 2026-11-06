import { NextResponse } from "next/server";
import { requireUser } from "@/lib/account-api";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
    return NextResponse.json({ error: "معرّف الطلب غير صالح" }, { status: 400 });
  }
  let body: any = {};
  try { body = await req.json(); } catch { /* optional body */ }
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 300) : null;
  const { data, error } = await getSupabaseAdmin().rpc("customer_cancel_pending_order", {
    p_order_id: params.id,
    p_user_id: auth.user.id,
    p_note: note,
  });
  if (error) {
    const message = error.message || "";
    const safe = ["لا يمكن إلغاء الطلب","الطلب غير موجود","الحساب غير صالح"].some((s) => message.includes(s));
    console.error("[api/orders/cancel]", error);
    return NextResponse.json({ error: safe ? message : "تعذر إلغاء الطلب، حاول مجدداً" }, { status: safe ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, result: data }, { headers: { "Cache-Control": "no-store" } });
}
