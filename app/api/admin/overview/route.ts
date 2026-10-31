import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, ok } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { LOW_STOCK_THRESHOLD } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { data, error } = await getSupabaseAdmin().rpc("admin_overview", { p_low_stock: LOW_STOCK_THRESHOLD });
  if (error) return dbFail("overview", error, "تعذر تحميل الإحصائيات");
  return ok({ overview: data });
}
