import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  try {
    const session = getSession();
    if (!session) return reply({ error: "يرجى تسجيل الدخول" }, 401);
    if (session.role !== "workshop") return reply({ error: "هذه الصفحة مخصصة للورشات" }, 403);

    const db = getSupabaseAdmin();
    const [{ data: user, error: userError }, { data: orders, error: ordersError }, { data: ledger, error: ledgerError }] = await Promise.all([
      db.from("users").select("id,name,tier,debt_limit,debt_balance,cashback_balance").eq("id", session.id).eq("role", "workshop").maybeSingle(),
      db.from("orders").select("id,order_number,total_amount,pay_method,status,created_at,items").eq("user_id", session.id).order("created_at", { ascending: false }).limit(100),
      db.from("debt_ledger").select("id,order_id,tx_type,amount,balance_after,note,created_at").eq("workshop_id", session.id).order("created_at", { ascending: false }).limit(100)
    ]);
    if (userError || ordersError || ledgerError) {
      console.error("[api/workshop/dashboard]", userError || ordersError || ledgerError);
      return reply({ error: "تعذر تحميل بيانات لوحة الورشة" }, 500);
    }
    if (!user) return reply({ error: "حساب الورشة غير موجود" }, 404);
    return reply({ user, orders: orders ?? [], ledger: ledger ?? [] });
  } catch (error) {
    console.error("[api/workshop/dashboard]", error);
    return reply({ error: "حدث خطأ غير متوقع" }, 500);
  }
}
