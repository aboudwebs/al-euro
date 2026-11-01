import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, ok } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { LOW_STOCK_THRESHOLD } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const db = getSupabaseAdmin();
  const [{ data, error }, { count: pendingRefunds, error: refundError }] = await Promise.all([
    db.rpc("admin_overview", { p_low_stock: LOW_STOCK_THRESHOLD }),
    db.from("orders").select("id", { count: "exact", head: true })
      .eq("pay_method", "sham").eq("refund_status", "pending_review"),
  ]);
  if (error) return dbFail("overview", error, "تعذر تحميل الإحصائيات");
  if (refundError) return dbFail("overview refund count", refundError, "تعذر تحميل إحصائيات الاسترداد");
  return ok({ overview: { ...data, pending_sham_refunds: pendingRefunds ?? 0 } });
}
