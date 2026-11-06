import { NextResponse } from "next/server";
import { requireUser } from "@/lib/account-api";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.response;
    if (auth.user.role !== "workshop") return reply({ error: "هذه الصفحة مخصصة للورشات" }, 403);

    const db = getSupabaseAdmin();
    const [{ data: user, error: userError }, { data: orders, error: ordersError }, { data: ledger, error: ledgerError }] = await Promise.all([
      db.from("users").select("id,name,tier,debt_limit,debt_balance,cashback_balance,loyalty_season_spend,loyalty_season_started_at").eq("id", auth.user.id).eq("role", "workshop").maybeSingle(),
      db.from("orders").select("id,order_number,total_amount,pay_method,status,created_at,items").eq("user_id", auth.user.id).order("created_at", { ascending: false }).limit(100),
      db.from("debt_ledger").select("id,order_id,tx_type,amount,balance_after,note,created_at").eq("workshop_id", auth.user.id).order("created_at", { ascending: false }).limit(100)
    ]);
    if (userError || ordersError || ledgerError) {
      console.error("[api/workshop/dashboard]", userError || ordersError || ledgerError);
      return reply({ error: "تعذر تحميل بيانات لوحة الورشة" }, 500);
    }
    if (!user) return reply({ error: "حساب الورشة غير موجود" }, 404);
    const userView: typeof user & { cashback_rate: number } = { ...user, cashback_rate: 0 };
    const seasonStart = user.loyalty_season_started_at ? new Date(user.loyalty_season_started_at).getTime() : 0;
    const activeSeason = seasonStart > 0 && Date.now() < seasonStart + 90 * 24 * 60 * 60 * 1000;
    const spend = activeSeason ? Number(user.loyalty_season_spend) || 0 : 0;
    if (!activeSeason) {
      userView.tier = "Standard";
      userView.loyalty_season_spend = 0;
      userView.loyalty_season_started_at = null;
    }
    userView.cashback_rate = spend >= 50000 ? 0.15 : spend >= 30000 ? 0.10 : spend >= 20000 ? 0.07 : spend >= 15000 ? 0.05 : spend >= 10000 ? 0.02 : 0;
    return reply({ user: userView, orders: orders ?? [], ledger: ledger ?? [] });
  } catch (error) {
    console.error("[api/workshop/dashboard]", error);
    return reply({ error: "حدث خطأ غير متوقع" }, 500);
  }
}
