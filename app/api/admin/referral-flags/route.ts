import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Referral signups that matched a suspicious pattern (see lib/referral-guard.ts), newest first. Read-only. */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { data, error } = await getSupabaseAdmin().from("referral_flags")
    .select("id, marketer_id, referred_user_id, reason, created_at")
    .order("created_at", { ascending: false }).limit(200);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json({ flags: [], ready: false }, { headers: NO_STORE });
    }
    console.error("[api/admin/referral-flags]", error);
    return NextResponse.json({ error: "تعذر قراءة التنبيهات" }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ flags: data ?? [], ready: true }, { headers: NO_STORE });
}
