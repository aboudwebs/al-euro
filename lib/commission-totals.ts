import type { SupabaseClient } from "@supabase/supabase-js";
import { commissionTotals, type AllocationRow, type CommissionRow, type CommissionTotals } from "@/lib/commission-math";

type PgError = { code?: string; message?: string } | null | undefined;
const isMissingTable = (err: PgError): boolean => err?.code === "42P01" || err?.code === "PGRST205";

/**
 * Reads every commission and every payout allocation and returns the admin totals (see lib/commission-math.ts).
 * Read-only: nothing is written, and the commission, debt and cashback rules are untouched.
 */
export async function loadCommissionTotals(db: SupabaseClient): Promise<{ ok: true; totals: CommissionTotals } | { ok: false; error: PgError }> {
  const { data: commissions, error } = await db.from("marketer_commissions").select("id, status, commission_amount").limit(100000);
  if (error) return { ok: false, error };
  const { data: allocations, error: allocationError } = await db
    .from("marketer_payout_allocations").select("commission_id, amount, status").limit(100000);
  // Before the partial-payout migration there is no allocations table: every commission then counts by its status.
  if (allocationError && !isMissingTable(allocationError)) return { ok: false, error: allocationError };
  return {
    ok: true,
    totals: commissionTotals((commissions ?? []) as CommissionRow[], (allocationError ? [] : (allocations ?? [])) as AllocationRow[]),
  };
}
