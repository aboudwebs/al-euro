import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SECRET = process.env.AUTH_SECRET;

type Role = "workshop" | "marketer" | "admin";

type Session = {
  role: Role;
  name: string;
  phone: string;
  iat: number;
};

function base64UrlToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function verifySession(token?: string): Promise<Session | null> {
  if (!token || !SECRET) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

    const encoder = new TextEncoder();
    const payloadText = new TextDecoder().decode(base64UrlToUint8Array(parts[0]));
    const signature = base64UrlToUint8Array(parts[1]);
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(signature).buffer,
      encoder.encode(payloadText)
    );
    if (!valid) return null;

    const payload = JSON.parse(payloadText) as Partial<Session>;
    const now = Date.now();
    if (
      (payload.role !== "workshop" && payload.role !== "marketer" && payload.role !== "admin") ||
      typeof payload.name !== "string" ||
      typeof payload.phone !== "string" ||
      typeof payload.iat !== "number" ||
      !Number.isFinite(payload.iat) ||
      payload.iat <= 0 ||
      payload.iat > now + 60_000 ||
      now - payload.iat > 30 * 24 * 60 * 60 * 1000
    ) return null;

    return {
      role: payload.role,
      name: payload.name,
      phone: payload.phone,
      iat: payload.iat,
    };
  } catch {
    return null;
  }
}

const isUnder = (pathname: string, base: string) => pathname === base || pathname.startsWith(base + "/");

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get("euro_session")?.value);

  // Public recovery endpoints must remain reachable without an admin session.
  if (isUnder(pathname, "/admin/reset-password") || isUnder(pathname, "/api/password-reset/admin") || isUnder(pathname, "/api/admin/reset-password")) {
    return NextResponse.next();
  }

  // ---- Admin API: early gate (each route still calls requireAdmin(), which also checks the database) ----
  if (isUnder(pathname, "/api/admin")) {
    if (!session) return NextResponse.json({ error: "يرجى تسجيل الدخول" }, { status: 401 });
    if (session.role !== "admin") return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    return NextResponse.next();
  }

  // ---- Admin pages ----
  if (isUnder(pathname, "/admin")) {
    if (pathname === "/admin/login") {
      return session?.role === "admin"
        ? NextResponse.redirect(new URL("/admin", req.url))
        : NextResponse.next();
    }
    if (!session) return NextResponse.redirect(new URL("/admin/login", req.url));
    if (session.role !== "admin") return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  const isLogin = pathname === "/login";
  const isProtectedPage =
    pathname === "/" ||
    isUnder(pathname, "/product") ||
    isUnder(pathname, "/cart") ||
    isUnder(pathname, "/special") ||
    isUnder(pathname, "/account") ||
    isUnder(pathname, "/workshop") ||
    isUnder(pathname, "/marketer");

  if (!isLogin && !isProtectedPage) return NextResponse.next();

  if (isLogin) {
    if (!session) return NextResponse.next();
    return NextResponse.redirect(new URL(session.role === "admin" ? "/admin" : "/account", req.url));
  }

  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isUnder(pathname, "/workshop") && session.role !== "workshop") {
    return NextResponse.redirect(new URL(session.role === "admin" ? "/admin" : "/marketer", req.url));
  }

  if (isUnder(pathname, "/marketer") && session.role !== "marketer") {
    return NextResponse.redirect(new URL(session.role === "admin" ? "/admin" : "/workshop", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/product/:path*",
    "/login",
    "/cart",
    "/cart/:path*",
    "/special",
    "/special/:path*",
    "/account",
    "/account/:path*",
    "/workshop",
    "/workshop/:path*",
    "/marketer",
    "/marketer/:path*",
    "/admin",
    "/admin/:path*",
    "/api/admin/:path*",
  ],
};
