import crypto from "crypto";
import { cookies, headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";

export const COOKIE_NAME = "euro_session";
export const SESSION_AGE = 60 * 60 * 24 * 30; // seconds

export type Role = "workshop" | "marketer" | "admin" | "worker";

export type Session = {
  id: string;
  role: Role;
  name: string;
  phone: string;
  my_ref_code?: string | null;
  iat: number;
  /** Token version of the account when this token was issued (absent on tokens issued before revocation existed = 0). */
  v?: number;
};

export function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not defined in environment variables");
  return secret;
}

const PASSWORD_HASH_PREFIX = "pbkdf2$sha256$";
const PASSWORD_HASH_ITERATIONS = 310_000;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(password, salt, PASSWORD_HASH_ITERATIONS, 32, "sha256");
  return PASSWORD_HASH_PREFIX + PASSWORD_HASH_ITERATIONS + "$" + salt.toString("hex") + "$" + derived.toString("hex");
}

/** Supports the old AUTH_SECRET HMAC hashes and upgrades them after a successful login. */
export function verifyPassword(storedHash: string, password: string): boolean {
  if (!storedHash.startsWith(PASSWORD_HASH_PREFIX)) {
    return safeEqual(storedHash, crypto.createHmac("sha256", getSecret()).update(password).digest("hex"));
  }
  try {
    const [, , iterationsRaw, saltHex, hashHex] = storedHash.split("$");
    const iterations = Number(iterationsRaw);
    if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000 ||
        !/^[0-9a-f]{32}$/i.test(saltHex ?? "") || !/^[0-9a-f]{64}$/i.test(hashHex ?? "")) return false;
    const actual = crypto.pbkdf2Sync(password, Buffer.from(saltHex, "hex"), iterations, 32, "sha256").toString("hex");
    return safeEqual(actual, hashHex);
  } catch {
    return false;
  }
}

export function isLegacyPasswordHash(storedHash: string): boolean {
  return !storedHash.startsWith(PASSWORD_HASH_PREFIX);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function signSession(payload: Session): string {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json).toString("base64url");
  const signature = crypto.createHmac("sha256", getSecret()).update(json).digest("base64url");
  return `${data}.${signature}`;
}

export function verifySession(token: string | undefined | null): Session | null {
  if (!token) return null;
  try {
    const [data, signature, extra] = token.split(".");
    if (!data || !signature || extra) return null;
    const json = Buffer.from(data, "base64url").toString("utf8");
    const expected = crypto.createHmac("sha256", getSecret()).update(json).digest();
    const received = Buffer.from(signature, "base64url");
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;

    const session = JSON.parse(json) as Partial<Session>;
    const now = Date.now();
    if (
      typeof session.id !== "string" ||
      (session.role !== "workshop" && session.role !== "marketer" && session.role !== "admin" && session.role !== "worker") ||
      typeof session.name !== "string" ||
      typeof session.phone !== "string" ||
      typeof session.iat !== "number" ||
      !Number.isFinite(session.iat) ||
      session.iat <= 0 ||
      session.iat > now + 60_000 ||
      now - session.iat > SESSION_AGE * 1000 ||
      (session.v !== undefined && (!Number.isInteger(session.v) || session.v < 0))
    ) return null;

    return session as Session;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Server-side revocation. Tokens stay signed and stateless, but every request also compares the token's version with
// users.token_version (and users.is_active). Changing a password, "sign out of all devices" and deactivating an account
// raise the version / switch the account off, so every token issued before that moment stops working.
// A token without `v` (issued before this existed) counts as version 0, so nobody is signed out when it is deployed.
// If the column is not there yet (migration not applied) every account is simply at version 0.
// ---------------------------------------------------------------------------------------------------------------------

export class SessionStoreError extends Error {
  constructor(message = "session store unavailable") {
    super(message);
  }
}

type AccountState = { version: number; active: boolean };
const STATE_TTL_MS = 10_000;
const STATE_MAX = 5_000;
const stateCache = new Map<string, { state: AccountState; expires: number }>();

function isUndefinedColumn(err: { code?: string } | null | undefined): boolean {
  return err?.code === "42703" || err?.code === "PGRST204";
}

async function readAccountState(userId: string, useCache = true): Promise<AccountState | null> {
  const now = Date.now();
  const cached = stateCache.get(userId);
  if (useCache && cached && cached.expires > now) return cached.state;

  const db = getSupabaseAdmin();
  let { data, error } = await db.from("users").select("token_version, is_active").eq("id", userId).maybeSingle();
  if (error && isUndefinedColumn(error)) {
    const fallback = await db.from("users").select("is_active").eq("id", userId).maybeSingle();
    data = fallback.data ? { token_version: 0, is_active: fallback.data.is_active } : null;
    error = fallback.error;
  }
  if (error) {
    console.error("[session] account state lookup:", error);
    // Fail closed: a revoked token must not be accepted because the database hiccuped. Routes answer 500, not 401,
    // so a temporary outage never signs anybody out of the app.
    if (cached) return cached.state;
    throw new SessionStoreError();
  }
  if (!data) return null;

  const state: AccountState = {
    version: Number.isInteger(data.token_version) ? Number(data.token_version) : 0,
    active: data.is_active !== false,
  };
  if (stateCache.size >= STATE_MAX) stateCache.clear();
  stateCache.set(userId, { state, expires: now + STATE_TTL_MS });
  return state;
}

/** True when the (signature-valid) session still matches the account: exists, active, same token version. */
export async function isSessionCurrent(session: Session): Promise<boolean> {
  const state = await readAccountState(session.id);
  if (!state || !state.active) return false;
  return (session.v ?? 0) === state.version;
}

async function currentVersion(userId: string): Promise<number> {
  const state = await readAccountState(userId, false);
  return state?.version ?? 0;
}

/**
 * Signs a fresh access token for the account at its current token version. Used by every sign-in path and after a
 * password / phone change, and returned to native apps as `accessToken`.
 */
export async function mintAccessToken(session: Omit<Session, "iat" | "v">): Promise<string> {
  const v = await currentVersion(session.id);
  return signSession({ ...session, iat: Date.now(), v });
}

/**
 * Invalidates every token issued so far for this account (all devices, cookies and Bearer tokens alike) by raising
 * its version. Returns the new version, or null when the column does not exist yet (migration not applied).
 */
export async function bumpTokenVersion(userId: string): Promise<number | null> {
  const db = getSupabaseAdmin();
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await db.from("users").select("token_version").eq("id", userId).maybeSingle();
    if (error) {
      if (isUndefinedColumn(error)) {
        console.error("[session] token_version column is missing: apply the token_version migration to enable revocation");
        return null;
      }
      throw error;
    }
    if (!data) return null;
    const current = Number.isInteger(data.token_version) ? Number(data.token_version) : 0;
    const { data: updated, error: updateError } = await db.from("users")
      .update({ token_version: current + 1 }).eq("id", userId).eq("token_version", current).select("token_version").maybeSingle();
    if (updateError) throw updateError;
    if (updated) {
      stateCache.delete(userId);
      return current + 1;
    }
  }
  throw new Error("token version update kept conflicting");
}

/** Forgets the cached state of an account (after it was deactivated or reactivated by this process). */
export function forgetAccountState(userId: string) {
  stateCache.delete(userId);
}

/** Reads a signed session from the browser cookie or native-app Bearer header and checks it against the account. */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(COOKIE_NAME)?.value;
  let session: Session | null;
  if (cookieToken) {
    session = verifySession(cookieToken);
  } else {
    const headerStore = await headers();
    const authorization = headerStore.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    session = verifySession(match?.[1] ?? null);
  }
  if (!session) return null;
  return (await isSessionCurrent(session)) ? session : null;
}

function writeCookie(cookieStore: Awaited<ReturnType<typeof cookies>>, token: string) {
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_AGE,
  });
}

/** Signs the account in on this browser (cookie) and returns the token, so native clients can also receive it. */
export async function setSession(session: Omit<Session, "iat" | "v">): Promise<string> {
  const token = await mintAccessToken(session);
  writeCookie(await cookies(), token);
  return token;
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
