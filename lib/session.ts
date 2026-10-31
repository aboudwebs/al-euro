import crypto from "crypto";
import { cookies, headers } from "next/headers";

export const COOKIE_NAME = "euro_session";
export const SESSION_AGE = 60 * 60 * 24 * 30; // seconds

export type Role = "workshop" | "marketer" | "admin";

export type Session = {
  id: string;
  role: Role;
  name: string;
  phone: string;
  my_ref_code?: string | null;
  iat: number;
};

export function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not defined in environment variables");
  return secret;
}

export function hashPassword(password: string): string {
  return crypto.createHmac("sha256", getSecret()).update(password).digest("hex");
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
      (session.role !== "workshop" && session.role !== "marketer" && session.role !== "admin") ||
      typeof session.name !== "string" ||
      typeof session.phone !== "string" ||
      typeof session.iat !== "number" ||
      !Number.isFinite(session.iat) ||
      session.iat <= 0 ||
      session.iat > now + 60_000 ||
      now - session.iat > SESSION_AGE * 1000
    ) return null;

    return session as Session;
  } catch {
    return null;
  }
}

/** Reads a signed session from the browser cookie or native-app Bearer header. */
export function getSession(): Session | null {
  const cookieToken = cookies().get(COOKIE_NAME)?.value;
  if (cookieToken) return verifySession(cookieToken);
  const authorization = headers().get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return verifySession(match?.[1] ?? null);
}

export function setSession(session: Omit<Session, "iat">) {
  const token = signSession({ ...session, iat: Date.now() });
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_AGE,
  });
}

export function clearSession() {
  cookies().delete(COOKIE_NAME);
}
