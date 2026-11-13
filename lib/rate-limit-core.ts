/**
 * Pure in-process rate limiter (no imports, so it can be unit-tested with `node --test`).
 * It mirrors public.auth_rate_hit(): a fixed window, then a block of `blockSeconds` once the limit is exceeded.
 * It is used when the database limiter is unavailable, so a broken store never turns protection off.
 */
export type RateRule = { limit: number; windowSeconds: number; blockSeconds: number };
export type RateDecision = { allowed: boolean; retryAfter: number };

type Entry = { windowStart: number; attempts: number; blockedUntil: number };

export class MemoryRateLimiter {
  private entries = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(maxEntries = 20_000, now: () => number = Date.now) {
    this.maxEntries = maxEntries;
    this.now = now;
  }

  get size(): number {
    return this.entries.size;
  }

  /** `increment: false` only asks "is this key blocked right now?" without counting an attempt. */
  hit(key: string, rule: RateRule, increment = true): RateDecision {
    const now = this.now();
    let entry = this.entries.get(key);
    if (entry && entry.blockedUntil > now) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)) };
    }
    if (!increment) return { allowed: true, retryAfter: 0 };

    if (!entry || entry.windowStart + rule.windowSeconds * 1000 <= now) {
      entry = { windowStart: now, attempts: 0, blockedUntil: 0 };
    }
    entry.attempts += 1;
    if (entry.attempts > rule.limit) {
      entry.blockedUntil = now + rule.blockSeconds * 1000;
      this.store(key, entry, now);
      return { allowed: false, retryAfter: rule.blockSeconds };
    }
    entry.blockedUntil = 0;
    this.store(key, entry, now);
    return { allowed: true, retryAfter: 0 };
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private store(key: string, entry: Entry, now: number): void {
    this.entries.set(key, entry);
    if (this.entries.size <= this.maxEntries) return;
    for (const [k, v] of this.entries) {
      if (v.blockedUntil <= now && v.windowStart + 3_600_000 <= now) this.entries.delete(k);
    }
    // Still too large (an attack with many distinct keys): drop the oldest entries.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
