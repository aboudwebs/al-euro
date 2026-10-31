import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const NO_STORE = { "Cache-Control": "no-store" };

export function ok(body: Record<string, unknown> = {}, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status, headers: NO_STORE });
}

export function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

type PgError = { code?: string; message?: string } | null | undefined;

/** P0001 = a message raised on purpose by our SQL functions (already Arabic) -> show it; anything else is logged. */
export function dbFail(context: string, err: PgError, fallback = "تعذر تنفيذ العملية") {
  if (err?.code === "P0001" && err.message) return fail(err.message, 400);
  if (err?.code === "42883" || err?.code === "PGRST202") {
    console.error(`[admin] ${context}: SQL function missing - run supabase/admin_full_setup.sql`, err);
    return fail("دوال قاعدة البيانات غير مثبّتة: شغّل ملف supabase/admin_full_setup.sql في Supabase", 500);
  }
  if (err?.code === "42703" && /status_note/.test(err.message ?? "")) {
    return fail("العمود status_note غير موجود: شغّل ملف supabase/admin_full_setup.sql", 500);
  }
  console.error(`[admin] ${context}:`, err);
  return fail(fallback, 500);
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Strips characters that would break a PostgREST `or(...)` filter. */
export function cleanSearch(q: string | null): string {
  return (q ?? "").replace(/[^\p{L}\p{N}\s@._+-]/gu, "").trim().slice(0, 60);
}

export function clampLimit(raw: string | null, def = 200, max = 500): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : def;
}

/**
 * Turns storage paths saved in *_url columns into short-lived signed URLs (the buckets are private).
 * Values that are already http(s) URLs pass through unchanged.
 */
export async function signStored(bucket: string, values: (string | null | undefined)[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const paths: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (/^https?:\/\//i.test(v)) out[v] = v;
    else if (!paths.includes(v)) paths.push(v);
  }
  if (!paths.length) return out;
  const { data, error } = await getSupabaseAdmin().storage.from(bucket).createSignedUrls(paths, 60 * 60);
  if (error) {
    console.error(`[admin] sign ${bucket}:`, error);
    return out;
  }
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}

export const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
