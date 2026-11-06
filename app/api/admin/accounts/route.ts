import { requireAdmin } from "@/lib/admin-guard";
import { clampLimit, cleanSearch, dbFail, ok } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// password_hash is never selected.
const FIELDS =
  "id, role, name, phone, license, license_verification_status, license_verification_workshop_name, license_verification_address, license_verification_evidence, license_verification_notes, license_verification_reviewed_at, city, specs, tier, debt_limit, debt_balance, cashback_balance, loyalty_season_spend, loyalty_season_started_at, my_ref_code, referred_by_code, is_active, created_at";

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const role = url.searchParams.get("role");
  const status = url.searchParams.get("status");
  const q = cleanSearch(url.searchParams.get("q"));

  const db = getSupabaseAdmin();
  let query = db.from("users").select(FIELDS).in("role", role === "workshop" || role === "marketer" ? [role] : ["workshop", "marketer"]);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  if (q) query = query.or(`name.ilike.*${q}*,phone.ilike.*${q}*,city.ilike.*${q}*`);
  const { data, error } = await query.order("is_active", { ascending: true }).order("created_at", { ascending: false }).limit(clampLimit(url.searchParams.get("limit")));
  if (error) return dbFail("accounts list", error, "تعذر تحميل الحسابات");

  const codes = Array.from(new Set((data ?? []).map((u) => u.referred_by_code).filter(Boolean)));
  const marketers: Record<string, string> = {};
  if (codes.length) {
    const { data: m } = await db.from("users").select("my_ref_code, name").in("my_ref_code", codes);
    for (const row of m ?? []) if (row.my_ref_code) marketers[row.my_ref_code] = row.name;
  }

  const marketerIds = (data ?? []).filter((u) => u.role === "marketer").map((u) => u.id);
  const commissionTotals: Record<string, { available: number; held: number; requested: number; paid: number }> = {};
  if (marketerIds.length) {
    const { data: commissions, error: commissionsError } = await db.from("marketer_commissions")
      .select("id,marketer_id,commission_amount,status").in("marketer_id", marketerIds);
    if (commissionsError) return dbFail("marketer account commissions", commissionsError, "تعذر تحميل أرصدة عمولات المسوّقين");
    const commissionIds = (commissions ?? []).map((c) => c.id);
    const { data: allocations, error: allocationsError } = commissionIds.length
      ? await db.from("marketer_payout_allocations").select("commission_id,amount,status").in("commission_id", commissionIds)
      : { data: [], error: null };
    if (allocationsError) return dbFail("marketer commission allocations", allocationsError, "تعذر تحميل تفاصيل طلبات تحويل العمولات");
    const allocated = new Map<string, { pending: number; paid: number }>();
    for (const item of allocations ?? []) {
      const value = allocated.get(item.commission_id) ?? { pending: 0, paid: 0 };
      if (item.status === "pending") value.pending += Number(item.amount) || 0;
      if (item.status === "paid") value.paid += Number(item.amount) || 0;
      allocated.set(item.commission_id, value);
    }
    for (const row of commissions ?? []) {
      const total = commissionTotals[row.marketer_id] ??= { available: 0, held: 0, requested: 0, paid: 0 };
      const amount = Number(row.commission_amount) || 0;
      const parts = allocated.get(row.id) ?? { pending: 0, paid: 0 };
      if (row.status === "held") { total.held += amount; continue; }
      const legacyPaid = row.status === "paid" && parts.paid === 0 && parts.pending === 0 ? amount : 0;
      const legacyRequested = row.status === "payout_requested" && parts.paid === 0 && parts.pending === 0 ? amount : 0;
      total.paid += parts.paid + legacyPaid;
      total.requested += parts.pending + legacyRequested;
      total.available += Math.max(0, amount - parts.paid - parts.pending - legacyPaid - legacyRequested);
    }
  }

  const accounts = (data ?? []).map((u) => {
    const spend = Number(u.loyalty_season_spend) || 0;
    const seasonStart = u.loyalty_season_started_at ? new Date(u.loyalty_season_started_at).getTime() : 0;
    const activeSeason = seasonStart > 0 && Date.now() < seasonStart + 90 * 24 * 60 * 60 * 1000;
    const tier = u.role !== "workshop" ? u.tier : !activeSeason ? "Standard" : spend >= 50000 ? "Elite" : spend >= 30000 ? "Platinum" : spend >= 20000 ? "Gold" : spend >= 15000 ? "Silver" : spend >= 10000 ? "Bronze" : "Standard";
    const commissions = commissionTotals[u.id] ?? { available: 0, held: 0, requested: 0, paid: 0 };
    return { ...u, tier, marketer_commissions: u.role === "marketer" ? {
      available: Math.round(commissions.available * 100) / 100,
      held: Math.round(commissions.held * 100) / 100,
      requested: Math.round(commissions.requested * 100) / 100,
      paid: Math.round(commissions.paid * 100) / 100,
      total: Math.round((commissions.available + commissions.held + commissions.requested + commissions.paid) * 100) / 100,
    } : null, referred_by_name: u.referred_by_code ? marketers[u.referred_by_code] ?? null : null };
  });
  return ok({ accounts });
}
