import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  try {
    const session = getSession();
    if (!session) return reply({ error: "يرجى تسجيل الدخول" }, 401);
    if (session.role !== "marketer") return reply({ error: "هذه الصفحة مخصصة للمسوّقين" }, 403);

    const db = getSupabaseAdmin();
    const { data: marketer, error: userError } = await db.from("users")
      .select("id,name,my_ref_code").eq("id", session.id).eq("role", "marketer").maybeSingle();
    if (userError) {
      console.error("[api/marketer/dashboard] user:", userError);
      return reply({ error: "تعذر تحميل حساب المسوّق" }, 500);
    }
    if (!marketer) return reply({ error: "حساب المسوّق غير موجود" }, 404);
    if (!marketer.my_ref_code) return reply({ error: "لم يتم إنشاء كود دعوة لحسابك بعد" }, 409);

    const [{ count, error: workshopsError }, { data: commissions, error: commissionsError }] = await Promise.all([
      db.from("users").select("id", { count: "exact", head: true })
        .eq("role", "workshop").eq("referred_by_code", marketer.my_ref_code),
      db.from("marketer_commissions").select("commission_amount,status")
        .eq("marketer_id", marketer.id)
    ]);
    if (workshopsError || commissionsError) {
      console.error("[api/marketer/dashboard]", workshopsError || commissionsError);
      return reply({ error: "تعذر تحميل إحصائيات المسوّق" }, 500);
    }
    const totals = { available: 0, held: 0, paid: 0 };
    for (const row of commissions ?? []) {
      const amount = Number(row.commission_amount) || 0;
      if (row.status === "available") totals.available += amount;
      else if (row.status === "held") totals.held += amount;
      else if (row.status === "paid") totals.paid += amount;
    }
    const referralSignature = crypto.createHmac("sha256", process.env.AUTH_SECRET || "").update(`workshop-referral:${marketer.my_ref_code}`).digest("hex");
    const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://al-euro-cdzo.onrender.com").origin;
    const referralUrl = `${origin}/login?ref=${encodeURIComponent(marketer.my_ref_code)}&sig=${referralSignature}`;
    return reply({
      marketer: { name: marketer.name, code: marketer.my_ref_code, referralUrl },
      workshops: count ?? 0,
      commissions: {
        available: Math.round(totals.available * 100) / 100,
        held: Math.round(totals.held * 100) / 100,
        paid: Math.round(totals.paid * 100) / 100,
        total: Math.round((totals.available + totals.held + totals.paid) * 100) / 100
      }
    });
  } catch (error) {
    console.error("[api/marketer/dashboard]", error);
    return reply({ error: "حدث خطأ غير متوقع" }, 500);
  }
}
