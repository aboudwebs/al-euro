import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getSession } from "@/lib/session";

/** Shared helpers of the signed-in customer endpoints under /api/account/* and /api/settings/. */

export const NO_STORE = { "Cache-Control": "no-store" };

export function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

type PgError = { code?: string; message?: string } | null | undefined;

export function isUndefinedColumn(err: PgError): boolean {
  return err?.code === "42703" || err?.code === "PGRST204";
}

export function isMissingTable(err: PgError): boolean {
  return err?.code === "42P01" || err?.code === "PGRST205" || err?.code === "42883" || err?.code === "PGRST202";
}

const NOT_READY = "هذه الميزة غير مفعّلة بعد على الخادم (تحتاج تحديث قاعدة البيانات). تواصل مع الإدارة.";

export function dbError(context: string, err: PgError, fallback = "حدث خطأ غير متوقع في الخادم") {
  if (isMissingTable(err) || isUndefinedColumn(err)) {
    console.error(`[api/account] ${context}: run the required Supabase migration`, err);
    return reply({ error: NOT_READY, code: "not_ready" }, 503);
  }
  console.error(`[api/account] ${context}:`, err);
  return reply({ error: fallback }, 500);
}

export type AccountUser = {
  id: string;
  role: "workshop" | "marketer" | "admin";
  name: string;
  phone: string;
  city: string | null;
  license: string | null;
  is_active: boolean;
  password_hash: string | null;
  debt_balance: number | null;
  debt_limit: number | null;
  cashback_balance: number | null;
  phone_verification_required?: boolean;
};

/** Re-reads the customer and enforces any pending phone-verification requirement server-side. */
export async function requireUser(): Promise<{ ok: true; user: AccountUser } | { ok: false; response: NextResponse }> {
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch {
    return { ok: false, response: reply({ error: "إعداد AUTH_SECRET مفقود على الخادم" }, 500) };
  }
  if (!session) return { ok: false, response: reply({ error: "يرجى تسجيل الدخول أولاً" }, 401) };
  if (!isUuid(session.id)) return { ok: false, response: reply({ error: "الجلسة غير صالحة، سجّل الدخول مجدداً" }, 401) };

  const db = getSupabaseAdmin();
  const fields = "id, role, name, phone, city, license, is_active, password_hash, debt_balance, debt_limit, cashback_balance";
  const initialLookup = await db.from("users")
    .select(`${fields}, phone_verification_required`)
    .eq("id", session.id)
    .maybeSingle();
  type AccountLookup = AccountUser & { phone_verification_required?: boolean };
  let data: AccountLookup | null = initialLookup.data as AccountLookup | null;
  let error = initialLookup.error;

  // Backward compatibility during deployment: old database schemas have no verification column yet.
  if (isUndefinedColumn(error)) {
    const fallback = await db.from("users").select(fields).eq("id", session.id).maybeSingle();
    data = fallback.data as AccountLookup | null;
    error = fallback.error;
  }
  if (error) {
    console.error("[api/account] user lookup:", error);
    return { ok: false, response: reply({ error: "تعذر التحقق من الحساب" }, 500) };
  }
  if (!data || !data.is_active) return { ok: false, response: reply({ error: "الحساب غير مفعّل" }, 403) };
  if (data.phone_verification_required === true) {
    return { ok: false, response: reply({ error: "يجب توثيق رقم الهاتف قبل استخدام خدمات الحساب" }, 403) };
  }
  if (data.role !== "workshop" && data.role !== "marketer") {
    return { ok: false, response: reply({ error: "هذه الخدمة لحسابات الورشات والمسوّقين فقط" }, 403) };
  }
  return { ok: true, user: data as AccountUser };
}

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Optional text field: absent -> undefined (keep), "" or null -> null (clear), too long -> error text. */
export function optText(body: Record<string, unknown>, key: string, label: string, max: number): { value?: string | null; error?: string } {
  if (!(key in body)) return {};
  const raw = body[key];
  if (raw === null) return { value: null };
  if (typeof raw !== "string") return { error: `${label} غير صالح` };
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length > max) return { error: `${label} طويل جداً (الحد ${max} حرفاً)` };
  return { value: text || null };
}

/** Phone numbers are kept as digits only (international format without "+", like the WhatsApp chat id). */
export function cleanPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.trim().replace(/^\+/, "").replace(/[\s\-()]/g, "");
  return /^\d{8,15}$/.test(digits) ? digits : null;
}
