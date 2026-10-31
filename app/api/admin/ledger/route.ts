import { requireAdmin } from "@/lib/admin-guard";
import { clampLimit, cleanSearch, dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Workshops with their credit position + ledger history. ?workshop=<uuid> limits the history to one workshop. */
export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const workshop = url.searchParams.get("workshop");
  const q = cleanSearch(url.searchParams.get("q"));
  if (workshop && !isUuid(workshop)) return fail("معرّف الورشة غير صالح");

  const db = getSupabaseAdmin();
  let wq = db.from("users").select("id, name, phone, city, tier, debt_limit, debt_balance, is_active").eq("role", "workshop");
  if (q) wq = wq.or(`name.ilike.*${q}*,phone.ilike.*${q}*`);
  const { data: workshops, error } = await wq.order("debt_balance", { ascending: false }).limit(500);
  if (error) return dbFail("ledger workshops", error, "تعذر تحميل الورشات");

  let lq = db.from("debt_ledger").select("id, workshop_id, order_id, tx_type, amount, balance_after, note, created_at");
  if (workshop) lq = lq.eq("workshop_id", workshop);
  const { data: entries, error: lerr } = await lq.order("created_at", { ascending: false }).limit(clampLimit(url.searchParams.get("limit"), 100, 500));
  if (lerr) return dbFail("ledger entries", lerr, "تعذر تحميل سجل الدين");

  // Attach order numbers for display.
  const orderIds = Array.from(new Set((entries ?? []).map((e) => e.order_id).filter(Boolean)));
  const numbers: Record<string, number> = {};
  if (orderIds.length) {
    const { data: o } = await db.from("orders").select("id, order_number").in("id", orderIds);
    for (const row of o ?? []) numbers[String(row.id)] = row.order_number;
  }
  const names: Record<string, string> = {};
  for (const w of workshops ?? []) names[String(w.id)] = w.name;

  return ok({
    workshops: workshops ?? [],
    entries: (entries ?? []).map((e) => ({
      ...e,
      order_number: e.order_id ? numbers[String(e.order_id)] ?? null : null,
      workshop_name: names[String(e.workshop_id)] ?? null,
    })),
  });
}

/** Body: { workshop_id: uuid, amount: number, note?: string } -> a 'payment' ledger row; held commissions are released. */
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await readJson(req);
  if (!body || !isUuid(body.workshop_id)) return fail("الورشة غير صالحة");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return fail("مبلغ التسديد غير صالح");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";

  const { data, error } = await getSupabaseAdmin().rpc("admin_record_debt_payment", {
    p_workshop_id: body.workshop_id,
    p_amount: amount,
    p_note: note || null,
  });
  if (error) return dbFail("record payment", error, "تعذر تسجيل التسديد");
  return ok({ result: data });
}
