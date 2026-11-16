import { requireAdmin } from "@/lib/admin-guard";
import { clampLimit, dbFail, fail, ok } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { COMMISSION_STATUS } from "@/lib/status";
import { loadCommissionTotals } from "@/lib/commission-totals";

export const dynamic = "force-dynamic";

/**
 * Filter by the actual allocated amounts, not only the commission's overall status.
 * A partial payout leaves the commission itself available while part of it is already paid.
 */
export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const validStatus = status && (Object.values(COMMISSION_STATUS) as string[]).includes(status) ? status : null;
  const limit = clampLimit(url.searchParams.get("limit"));
  const db = getSupabaseAdmin();

  // Load commissions before filtering: a partially paid commission can belong to
  // both the "paid" and "available" views at the same time.
  const { data, error } = await db.from("marketer_commissions")
    .select("id, marketer_id, workshop_id, order_id, order_amount, commission_amount, status, created_at")
    .order("created_at", { ascending: false }).limit(100000);
  if (error) return dbFail("commissions list", error, "تعذر تحميل العمولات");

  const computed = await loadCommissionTotals(db);
  if (!computed.ok) return dbFail("commission totals", computed.error, "تعذر حساب الإجماليات");

  const commissionIds = (data ?? []).map((c) => c.id);
  const { data: allocations, error: allocationsError } = commissionIds.length
    ? await db.from("marketer_payout_allocations").select("commission_id, amount, status").in("commission_id", commissionIds)
    : { data: [], error: null };
  if (allocationsError) return dbFail("commission allocations", allocationsError, "تعذر حساب رصيد العمولات");

  const allocated = new Map<string, { pending: number; paid: number }>();
  for (const row of allocations ?? []) {
    const item = allocated.get(row.commission_id) ?? { pending: 0, paid: 0 };
    if (row.status === "pending") item.pending += Number(row.amount) || 0;
    if (row.status === "paid") item.paid += Number(row.amount) || 0;
    allocated.set(row.commission_id, item);
  }

  const mapped = (data ?? []).map((c) => {
    const amounts = allocated.get(c.id) ?? { pending: 0, paid: 0 };
    const hasAllocations = amounts.pending > 0 || amounts.paid > 0;
    const gross = Number(c.commission_amount) || 0;
    const legacyPaid = c.status === "paid" && !hasAllocations ? gross : 0;
    const legacyReserved = c.status === "payout_requested" && !hasAllocations ? gross : 0;
    const paidAmount = Math.round((amounts.paid + legacyPaid) * 100) / 100;
    const reservedAmount = Math.round((amounts.pending + legacyReserved) * 100) / 100;
    const remainingAmount = Math.max(0, Math.round((gross - paidAmount - reservedAmount) * 100) / 100);
    return {
      ...c,
      paid_amount: paidAmount,
      reserved_amount: reservedAmount,
      remaining_amount: remainingAmount,
    };
  });

  const filtered = mapped.filter((c) => {
    if (!validStatus) return true;
    if (validStatus === "held") return c.status === "held";
    if (validStatus === "paid") return c.paid_amount > 0;
    if (validStatus === "payout_requested") return c.reserved_amount > 0;
    if (validStatus === "available") return c.status !== "held" && c.remaining_amount > 0;
    return c.status === validStatus;
  }).slice(0, limit);

  const userIds = Array.from(new Set(filtered.flatMap((c) => [c.marketer_id, c.workshop_id]).filter(Boolean)));
  const orderIds = Array.from(new Set(filtered.map((c) => c.order_id).filter(Boolean)));
  const names: Record<string, string> = {};
  const numbers: Record<string, number> = {};
  if (userIds.length) {
    const { data: users, error: usersError } = await db.from("users").select("id, name").in("id", userIds);
    if (usersError) return dbFail("commission users", usersError, "تعذر تحميل أسماء المسوّقين والورشات");
    for (const row of users ?? []) names[String(row.id)] = row.name;
  }
  if (orderIds.length) {
    const { data: orders, error: ordersError } = await db.from("orders").select("id, order_number").in("id", orderIds);
    if (ordersError) return dbFail("commission orders", ordersError, "تعذر تحميل أرقام الطلبات");
    for (const row of orders ?? []) numbers[String(row.id)] = row.order_number;
  }

  return ok({
    totals: computed.totals,
    commissions: filtered.map((c) => ({
      ...c,
      marketer_name: names[String(c.marketer_id)] ?? "—",
      workshop_name: names[String(c.workshop_id)] ?? "—",
      order_number: numbers[String(c.order_id)] ?? null,
    })),
  });
}

/** Direct payment is disabled. Only marketer-submitted payout requests can be marked paid. */
export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  return fail("لا يمكن تسجيل العمولة كمدفوعة مباشرة. يجب أن يرسل المسوّق طلب سحب بالمبلغ المطلوب أولاً، ثم تتم مراجعته من قسم طلبات سحب العمولات.");
}
