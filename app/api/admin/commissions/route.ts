import { requireAdmin } from "@/lib/admin-guard";
import { clampLimit, dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { COMMISSION_STATUS } from "@/lib/status";

export const dynamic = "force-dynamic";

/** ?status=held|available|paid  (omit for all). Totals are always for the whole table. */
export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const db = getSupabaseAdmin();

  let query = db.from("marketer_commissions").select("id, marketer_id, workshop_id, order_id, order_amount, commission_amount, status, created_at");
  if (status && (Object.values(COMMISSION_STATUS) as string[]).includes(status)) query = query.eq("status", status);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(clampLimit(url.searchParams.get("limit")));
  if (error) return dbFail("commissions list", error, "تعذر تحميل العمولات");

  const { data: all, error: totalsError } = await db.from("marketer_commissions").select("status, commission_amount").limit(100000);
  if (totalsError) return dbFail("commission totals", totalsError, "تعذر حساب الإجماليات");
  const totals = { held: 0, available: 0, paid: 0 };
  for (const row of all ?? []) if (row.status in totals) totals[row.status as keyof typeof totals] += Number(row.commission_amount) || 0;

  const userIds = Array.from(new Set((data ?? []).flatMap((c) => [c.marketer_id, c.workshop_id]).filter(Boolean)));
  const orderIds = Array.from(new Set((data ?? []).map((c) => c.order_id).filter(Boolean)));
  const names: Record<string, string> = {};
  const numbers: Record<string, number> = {};
  if (userIds.length) {
    const { data: u } = await db.from("users").select("id, name").in("id", userIds);
    for (const row of u ?? []) names[String(row.id)] = row.name;
  }
  if (orderIds.length) {
    const { data: o } = await db.from("orders").select("id, order_number").in("id", orderIds);
    for (const row of o ?? []) numbers[String(row.id)] = row.order_number;
  }

  return ok({
    totals,
    commissions: (data ?? []).map((c) => ({
      ...c,
      marketer_name: names[String(c.marketer_id)] ?? "—",
      workshop_name: names[String(c.workshop_id)] ?? "—",
      order_number: numbers[String(c.order_id)] ?? null,
    })),
  });
}

/** Body: { ids: uuid[] } -> marks the selected 'available' commissions as 'paid'. */
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await readJson(req);
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every(isUuid)) return fail("لم يتم اختيار عمولات صالحة");

  const { data, error } = await getSupabaseAdmin().rpc("admin_mark_commissions_paid", { p_ids: ids });
  if (error) return dbFail("commissions pay", error, "تعذر تحديث العمولات");
  return ok({ result: data });
}
