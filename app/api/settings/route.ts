import { getSession } from "@/lib/session";
import { reply } from "@/lib/account-api";

export const dynamic = "force-dynamic";

const API_BASE_URL = "https://api.exchanger.sy";
const RATE_CACHE_TTL_MS = 60 * 1000;
const MAX_PAYMENT_RATE_AGE_MS = 10 * 60 * 1000;
const OLD_TO_NEW_SYP = 100;

type CachedRate = {
  rate: number;
  acceptedAt: number;
  sourceUpdatedAt: number | null;
  fetchedAt: number;
  denomination: "old" | "new";
  status: "fresh" | "cached";
};

let cachedRate: CachedRate | null = null;

function validUnixSeconds(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

async function getSyrRate(apiKey: string): Promise<CachedRate | null> {
  if (cachedRate && Date.now() - cachedRate.fetchedAt < RATE_CACHE_TTL_MS) {
    return cachedRate;
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/currencies/USD`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-API-Key": apiKey,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    console.error("[api/settings] SYR Rates HTTP status:", response.status);
    return null;
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") return null;

  const root = payload as {
    data?: {
      code?: unknown;
      sell?: unknown;
      accepted_at?: unknown;
      source_updated_at?: unknown;
      status?: unknown;
    };
    meta?: {
      denomination?: unknown;
    };
  };

  const data = root.data;
  const denomination = root.meta?.denomination;
  if (
    !data ||
    data.code !== "USD" ||
    (denomination !== "old" && denomination !== "new") ||
    (data.status !== "fresh" && data.status !== "cached")
  ) {
    console.error("[api/settings] SYR Rates response shape or denomination is invalid");
    return null;
  }

  const sellRate = Number(data.sell);
  const acceptedAt = validUnixSeconds(data.accepted_at);
  const sourceUpdatedAt = validUnixSeconds(data.source_updated_at);

  if (
    !Number.isFinite(sellRate) ||
    sellRate <= 0 ||
    sellRate >= 1_000_000_000 ||
    acceptedAt === null
  ) {
    console.error("[api/settings] SYR Rates USD sell price or accepted_at is invalid");
    return null;
  }

  const normalizedRate = denomination === "old"
    ? sellRate / OLD_TO_NEW_SYP
    : sellRate;

  if (!Number.isFinite(normalizedRate) || normalizedRate <= 0) return null;

  cachedRate = {
    rate: normalizedRate,
    acceptedAt,
    sourceUpdatedAt,
    fetchedAt: Date.now(),
    denomination,
    status: data.status,
  };

  return cachedRate;
}

/**
 * Returns the USD sell rate normalized to new Syrian pounds.
 * Cached/stale provider values may be displayed, but must not authorize
 * a Syrian-pound payment.
 */
export async function GET() {
  try {
    if (!getSession()) return reply({ error: "يرجى تسجيل الدخول" }, 401);

    const apiKey = process.env.SYR_RATES_API_KEY?.trim();
    if (!apiKey) {
      return reply({
        usdToSyp: null,
        rateUpdatedAt: null,
        rateSource: "syr-rates",
        sypUnit: "new",
        rateStatus: "unavailable",
        canUseSypPayments: false,
        rateError: "api_key_missing",
      });
    }

    const live = await getSyrRate(apiKey);
    if (!live) {
      return reply({
        usdToSyp: null,
        rateUpdatedAt: null,
        rateSource: "syr-rates",
        sypUnit: "new",
        rateStatus: "unavailable",
        canUseSypPayments: false,
        rateError: "provider_unavailable",
      });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const rateAgeSeconds = Math.max(0, nowSeconds - live.acceptedAt);
    const rateIsRecent = rateAgeSeconds * 1000 <= MAX_PAYMENT_RATE_AGE_MS;
    const canUseSypPayments = live.status === "fresh" && rateIsRecent;

    return reply({
      usdToSyp: live.rate,
      rateUpdatedAt: new Date(live.acceptedAt * 1000).toISOString(),
      sourceUpdatedAt: live.sourceUpdatedAt
        ? new Date(live.sourceUpdatedAt * 1000).toISOString()
        : null,
      rateSource: "syr-rates",
      sypUnit: "new",
      rateDenomination: live.denomination,
      rateStatus: canUseSypPayments ? "fresh" : "stale",
      providerStatus: live.status,
      rateAgeSeconds,
      canUseSypPayments,
    });
  } catch (err) {
    console.error("[api/settings] GET:", err);
    return reply({
      usdToSyp: null,
      rateUpdatedAt: null,
      rateSource: "syr-rates",
      sypUnit: "new",
      rateStatus: "unavailable",
      canUseSypPayments: false,
      rateError: "provider_unavailable",
    });
  }
}
