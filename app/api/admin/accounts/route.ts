import { requireAdmin } from "@/lib/admin-guard";
import { clampLimit, cleanSearch, dbFail, ok } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// password_hash is never selected.
const FIELDS =
  "id, role, name, phone, license, city, specs, tier, debt_limit, debt_balance, cashback_balance, my_ref_code, referred_by_code, is_active, created_at";

/** Workshops and marketers. ?role=workshop|marketer  ?status=active|inactive  ?q=name-or-phone */
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

  // Resolve "referred by" codes to marketer names.
  const codes = Array.from(new Set((data ?? []).map((u) => u.referred_by_code).filter(Boolean)));
  const marketers: Record<string, string> = {};
  if (codes.length) {
    const { data: m } = await db.from("users").select("my_ref_code, name").in("my_ref_code", codes);
    for (const row of m ?? []) if (row.my_ref_code) marketers[row.my_ref_code] = row.name;
  }

  const accounts = (data ?? []).map((u) => ({ ...u, referred_by_name: u.referred_by_code ? marketers[u.referred_by_code] ?? null : null }));
  return ok({ accounts });
}
