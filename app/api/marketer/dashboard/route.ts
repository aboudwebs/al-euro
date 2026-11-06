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
    if (userError) return reply({ error: "تعذر تحميل حساب المسوّق" }, 500);
    if (!marketer) return reply({ error: "حساب المسوّق غير موجود" }, 404);
    if (!marketer.my_ref_code) return reply({ error: "لم يتم إنشاء كود دعوة لحسابك بعد" }, 409);

    const [{ count, error: workshopsError }, { data: commissions, error: commissionsError }, { data: payoutRequests, error: payoutError }] = await Promise.all([
      db.from("users").select("id", { count: "exact", head: true })
        .eq("role", "workshop").eq("referred_by_code", marketer.my_ref_code),
      db.from("marketer_commissions").select("id,commission_amount,status").eq("marketer_id", marketer.id),
      db.from("marketer_payout_requests").select("id,amount,status,payout_details,admin_note,created_at,processed_at")
        .eq("marketer_id", marketer.id).order("created_at", { ascending: false }).limit(10),
    ]);
    if (workshopsError || commissionsError || payoutError) {
      console.error("[api/marketer/dashboard]", workshopsError || commissionsError || payoutError);
      return reply({ error: "تعذر تحميل إحصائيات المسوّق" }, 500);
    }
    const commissionIds = (commissions ?? []).map((c) => c.id);
    const { data: allocations, error: allocationsError } = commissionIds.length
      ? await db.from("marketer_payout_allocations").select("commission_id,amount,status").in("commission_id", commissionIds)
      : { data: [], error: null };
    if (allocationsError) {
      console.error("[api/marketer/dashboard] allocations", allocationsError);
      return reply({ error: "تعذر حساب رصيد العمولات" }, 500);
    }
    const allocatedByCommission = new Map<string, { pending: number; paid: number }>();
    for (const allocation of allocations ?? []) {
      const item = allocatedByCommission.get(allocation.commission_id) ?? { pending: 0, paid: 0 };
      if (allocation.status === "pending") item.pending += Number(allocation.amount) || 0;
      if (allocation.status === "paid") item.paid += Number(allocation.amount) || 0;
      allocatedByCommission.set(allocation.commission_id, item);
    }
    const totals = { available: 0, held: 0, requested: 0, paid: 0 };
    for (const row of commissions ?? []) {
      const amount = Number(row.commission_amount) || 0;
      const allocated = allocatedByCommission.get(row.id) ?? { pending: 0, paid: 0 };
      if (row.status === "held") {
        totals.held += amount;
        continue;
      }
      const legacyPaid = row.status === "paid" && allocated.paid === 0 && allocated.pending === 0 ? amount : 0;
      const legacyRequested = row.status === "payout_requested" && allocated.paid === 0 && allocated.pending === 0 ? amount : 0;
      totals.paid += allocated.paid + legacyPaid;
      totals.requested += allocated.pending + legacyRequested;
      totals.available += Math.max(0, amount - allocated.paid - allocated.pending - legacyPaid - legacyRequested);
    }
    const referralSignature = crypto.createHmac("sha256", process.env.AUTH_SECRET || "").update(`workshop-referral:${marketer.my_ref_code}`).digest("hex");
    const origin = new URL(process.env.NEXT_PUBLIC_REFERRAL_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://al-euro-cdzo.onrender.com").origin;
    const referralUrl = `${origin}/r?ref=${encodeURIComponent(marketer.my_ref_code)}&sig=${referralSignature}`;
    return reply({
      marketer: { name: marketer.name, code: marketer.my_ref_code, referralUrl },
      workshops: count ?? 0,
      commissions: {
        available: Math.round(totals.available * 100) / 100,
        held: Math.round(totals.held * 100) / 100,
        requested: Math.round(totals.requested * 100) / 100,
        paid: Math.round(totals.paid * 100) / 100,
        total: Math.round((totals.available + totals.held + totals.requested + totals.paid) * 100) / 100,
      },
      payoutRequest: payoutRequests?.[0] ?? null,
      payoutRequests: payoutRequests ?? [],
    });
  } catch (error) {
    console.error("[api/marketer/dashboard]", error);
    return reply({ error: "حدث خطأ غير متوقع" }, 500);
  }
}
