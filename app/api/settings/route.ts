import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { reply } from "@/lib/account-api";

export const dynamic = "force-dynamic";

/**
 * Public settings for signed-in customers. `usdToSyp` is the exchange rate the admin published in
 * public.app_settings (key 'usd_to_syp'); it is null until one is set, and the app then keeps showing dollars only.
 */
export async function GET() {
  try {
    if (!getSession()) return reply({ error: "يرجى تسجيل الدخول" }, 401);

    const { data, error } = await getSupabaseAdmin().from("app_settings").select("value").eq("key", "usd_to_syp").maybeSingle();
    if (error) {
      // Table missing (SQL not run yet) -> no rate; any other error is logged and also yields "no rate".
      if (error.code !== "42P01" && error.code !== "PGRST205") console.error("[api/settings] select:", error);
      return reply({ usdToSyp: null });
    }
    const rate = Number(String(data?.value ?? "").replace(/,/g, "").trim());
    return reply({ usdToSyp: Number.isFinite(rate) && rate > 0 && rate < 1_000_000_000 ? rate : null });
  } catch (err) {
    console.error("[api/settings] GET:", err);
    return reply({ usdToSyp: null });
  }
}
