import { getSession } from "@/lib/session";
import { reply } from "@/lib/account-api";
import { getStableInvoiceRate } from "@/lib/syr-rates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!await getSession()) return reply({ error: "يرجى تسجيل الدخول" }, 401);
    const live = await getStableInvoiceRate();
    if (!live) {
      return reply({
        usdToSyp: null, rateUpdatedAt: null, sourceUpdatedAt: null,
        rateSource: "syr-rates", sypUnit: "new", rateStatus: "unavailable",
        providerStatus: "unavailable", canUseSypInvoices: false,
        rateError: process.env.SYR_RATES_API_KEY ? "provider_unavailable" : "api_key_missing",
      });
    }
    return reply({
      usdToSyp: live.rate,
      rateUpdatedAt: live.acceptedAt ? new Date(live.acceptedAt * 1000).toISOString() : null,
      sourceUpdatedAt: new Date(live.sourceUpdatedAt * 1000).toISOString(),
      sourceAgeSeconds: Math.max(0, Math.floor(Date.now() / 1000) - live.sourceUpdatedAt),
      rateSource: "syr-rates", sypUnit: "new", rateDenomination: live.denomination,
      rateStatus: live.stable ? "stable" : "unstable",
      providerStatus: live.providerStatus,
      canUseSypInvoices: live.stable,
    });
  } catch (err) {
    console.error("[api/settings] GET:", err);
    return reply({
      usdToSyp: null, rateUpdatedAt: null, sourceUpdatedAt: null,
      rateSource: "syr-rates", sypUnit: "new", rateStatus: "unavailable",
      providerStatus: "unavailable", canUseSypInvoices: false, rateError: "provider_unavailable",
    });
  }
}
