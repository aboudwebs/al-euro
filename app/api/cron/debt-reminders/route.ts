import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifyUser } from "@/lib/push";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\\s+/i, "") ?? "";
  if (!secret || !supplied) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Run once daily from a Render Cron Job. Reminds workshops 5 days before the 30-day debt deadline. */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const db = getSupabaseAdmin();
  const { data: workshops, error: workshopsError } = await db.from("users")
    .select("id").eq("role", "workshop").eq("is_active", true).gt("debt_balance", 0);
  if (workshopsError) {
    console.error("[cron/debt-reminders] workshops", workshopsError);
    return NextResponse.json({ error: "تعذر تحميل الورشات" }, { status: 500 });
  }
  const ids = (workshops ?? []).map((row) => String(row.id));
  if (!ids.length) return NextResponse.json({ ok: true, reminders: 0 });

  const { data: debits, error: ledgerError } = await db.from("debt_ledger")
    .select("workshop_id,created_at").in("workshop_id", ids).eq("tx_type", "debit")
    .order("created_at", { ascending: false }).limit(10000);
  if (ledgerError) {
    console.error("[cron/debt-reminders] ledger", ledgerError);
    return NextResponse.json({ error: "تعذر تحميل سجل الديون" }, { status: 500 });
  }

  const latestDebit = new Map<string, string>();
  for (const row of debits ?? []) {
    const id = String(row.workshop_id);
    if (!latestDebit.has(id)) latestDebit.set(id, String(row.created_at));
  }

  const now = Date.now();
  const dueSoon = ids.filter((id) => {
    const createdAt = latestDebit.get(id);
    if (!createdAt) return false;
    const ageDays = (now - new Date(createdAt).getTime()) / 86_400_000;
    return ageDays >= 25 && ageDays < 30;
  });

  for (let offset = 0; offset < dueSoon.length; offset += 25) {
    await Promise.all(dueSoon.slice(offset, offset + 25).map((userId) => {
      const debitAt = latestDebit.get(userId)!;
      return notifyUser({
        userId,
        type: "debt_due_soon",
        title: "اقتراب موعد السداد",
        body: "اقترب موعد تسديد مستحقاتك",
        eventKey: `debt-due-soon:${userId}:${debitAt}`,
        data: { screen: "dashboard" },
      });
    }));
  }

  return NextResponse.json({ ok: true, reminders: dueSoon.length });
}
