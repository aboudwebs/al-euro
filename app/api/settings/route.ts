import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { reply } from "@/lib/account-api";

export const dynamic = "force-dynamic";

const RATE_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedRate = {
  rate: number;
  updatedAt: string;
  fetchedAt: number;
};

let cachedRate: CachedRate | null = null;

/**
 * Fetch the Syrian-market USD selling rate from SPToday.
 * The provider reports the Syrian pound unit explicitly; EURO currently displays
 * the legacy ("old") SYP unit, so any other unit is rejected.
 */
async function getSptodayRate(apiKey: string): Promise<CachedRate | null> {
  if (cachedRate && Date.now() - cachedRate.fetchedAt < RATE_CACHE_TTL_MS) {
    return cachedRate;
  }

  const response = await fetch("https://api-v2.sp-today.com/api/v1/currencies", {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-API-Key": apiKey,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    console.error("[api/settings] SPToday HTTP status:", response.status);
    return null;
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") return null;

  const root = payload as {
    ok?: unknown;
    data?: {
      unit?: unknown;
      updated_at?: unknown;
      currencies?: unknown;
    };
  };
  const data = root.data;
  if (root.ok !== true || !data || data.unit !== "old" || !Array.isArray(data.currencies)) {
    console.error("[api/settings] SPToday response shape or SYP unit is invalid");
    return null;
  }

  const usd = data.currencies.find((item: unknown) => {
    return !!item && typeof item === "object" && (item as { code?: unknown }).code === "USD";
  }) as {
    cities?: {
      damascus?: {
        sell?: unknown;
      };
    };
    updated_at?: unknown;
  } | undefined;

  const rate = Number(usd?.cities?.damascus?.sell);
  const updatedAt = typeof usd?.updated_at === "string"
    ? usd.updated_at
    : typeof data.updated_at === "string"
      ? data.updated_at
      : "";

  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1_000_000_000 || !updatedAt || !Number.isFinite(Date.parse(updatedAt))) {
    console.error("[api/settings] SPToday USD selling rate is missing or invalid");
    return null;
  }

  cachedRate = { rate, updatedAt, fetchedAt: Date.now() };
  return cachedRate;
}

/**
 * Public settings for signed-in customers. Prefer SPToday's USD selling rate.
 * If SPTODAY_API_KEY is not configured, retain the existing admin-published
 * Supabase rate as a backward-compatible fallback.
 */
export async function GET() {
  try {
    if (!getSession()) return reply({ error: "يرجى تسجيل الدخول" }, 401);

    const apiKey = process.env.SPTODAY_API_KEY?.trim();
    if (apiKey) {
      const live = await getSptodayRate(apiKey);
      return reply({
        usdToSyp: live?.rate ?? null,
        rateUpdatedAt: live?.updatedAt ?? null,
        rateSource: "sptoday",
        sypUnit: "old",
      });
    }

    const { data, error } = await getSupabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", "usd_to_syp")
      .maybeSingle();

    if (error) {
      if (error.code !== "42P01" && error.code !== "PGRST205") {
        console.error("[api/settings] select:", error);
      }
      return reply({ usdToSyp: null });
    }

    const rate = Number(String(data?.value ?? "").replace(/,/g, "").trim());
    return reply({
      usdToSyp: Number.isFinite(rate) && rate > 0 && rate < 1_000_000_000 ? rate : null,
      rateSource: "admin",
      sypUnit: "old",
    });
  } catch (err) {
    console.error("[api/settings] GET:", err);
    return reply({ usdToSyp: null });
  }
}
