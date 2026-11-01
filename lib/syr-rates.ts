const API_BASE_URL = "https://api.exchanger.sy";
const CACHE_TTL_MS = 30 * 1000;
const MAX_SOURCE_AGE_MS = 10 * 60 * 1000;
const MAX_WINDOW_CHANGE = 0.01;
const OLD_TO_NEW_SYP = 100;

export type StableInvoiceRate = {
  rate: number;
  acceptedAt: number | null;
  sourceUpdatedAt: number;
  stable: boolean;
  providerStatus: "fresh" | "cached";
  denomination: "old" | "new";
};

let cached: { value: StableInvoiceRate; fetchedAt: number } | null = null;

function unixSeconds(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalize(value: unknown, denomination: "old" | "new"): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n >= 1_000_000_000) return null;
  const normalized = denomination === "old" ? n / OLD_TO_NEW_SYP : n;
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

export async function getStableInvoiceRate(forceRefresh = false): Promise<StableInvoiceRate | null> {
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const apiKey = process.env.SYR_RATES_API_KEY?.trim();
  if (!apiKey) return null;

  const headers = { Accept: "application/json", "X-API-Key": apiKey };
  const currentResponse = await fetch(`${API_BASE_URL}/api/v1/currencies/USD`, {
    headers, cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  if (!currentResponse.ok) return null;

  const currentPayload = await currentResponse.json() as {
    data?: { code?: unknown; sell?: unknown; accepted_at?: unknown; source_updated_at?: unknown; status?: unknown };
    meta?: { denomination?: unknown };
  };
  const item = currentPayload.data;
  const denomination = currentPayload.meta?.denomination;
  if (
    !item || item.code !== "USD" ||
    (denomination !== "old" && denomination !== "new") ||
    (item.status !== "fresh" && item.status !== "cached")
  ) return null;

  const rate = normalize(item.sell, denomination);
  const sourceUpdatedAt = unixSeconds(item.source_updated_at);
  if (rate === null || sourceUpdatedAt === null) return null;

  const now = Date.now();
  const sourceAgeMs = now - sourceUpdatedAt * 1000;
  let stable = item.status === "fresh" && sourceAgeMs >= -60_000 && sourceAgeMs <= MAX_SOURCE_AGE_MS;

  if (stable) {
    const to = new Date(now).toISOString();
    const from = new Date(now - 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({ type: "currency", code: "USD", from, to, page: "1", per_page: "100" });
    const historyResponse = await fetch(`${API_BASE_URL}/api/v1/history?${params.toString()}`, {
      headers, cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    if (!historyResponse.ok) {
      stable = false;
    } else {
      const historyPayload = await historyResponse.json() as {
        data?: Array<{ sell?: unknown }>;
        meta?: { denomination?: unknown };
      };
      if (!Array.isArray(historyPayload.data) || historyPayload.meta?.denomination !== denomination) {
        stable = false;
      } else {
        const prices = [rate, ...historyPayload.data
          .map((entry) => normalize(entry.sell, denomination))
          .filter((value): value is number => value !== null)];
        const lowest = Math.min(...prices);
        const highest = Math.max(...prices);
        stable = lowest > 0 && (highest - lowest) / lowest <= MAX_WINDOW_CHANGE;
      }
    }
  }

  const value: StableInvoiceRate = {
    rate,
    acceptedAt: unixSeconds(item.accepted_at),
    sourceUpdatedAt,
    stable,
    providerStatus: item.status,
    denomination,
  };
  cached = { value, fetchedAt: now };
  return value;
}
