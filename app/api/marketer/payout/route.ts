import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: "يرجى تسجيل الدخول" }, { status: 401 });
  if (session.role !== "marketer") return NextResponse.json({ error: "هذه الخدمة مخصصة للمسوّقين" }, { status: 403 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "البيانات غير صالحة" }, { status: 400 }); }
  const amount = typeof body?.amount === "number" ? body.amount : Number(body?.amount);
  const payoutDetails = typeof body?.payoutDetails === "string" ? body.payoutDetails.trim() : "";
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
    return NextResponse.json({ error: "أدخل مبلغ سحب صحيحاً حتى منزلتين عشريتين" }, { status: 400 });
  }
  if (payoutDetails.length > 1000) {
    return NextResponse.json({ error: "معلومات السحب طويلة جداً" }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdmin().rpc("request_marketer_payout", {
    p_marketer_id: session.id,
    p_amount: amount,
    p_payout_details: payoutDetails || null,
  });
  if (error) {
    console.error("[api/marketer/payout]", error);
    const known = ["لا توجد عمولات","طلب سحب قيد المراجعة","معلومات السحب","غير مفعّل","تغيرت حالة","رصيد العمولات","مبلغ السحب"].some((s) => error.message.includes(s));
    return NextResponse.json({ error: known ? error.message : "تعذر إرسال طلب التحويل" }, { status: known ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, request: data }, { headers: { "Cache-Control": "no-store" } });
}
