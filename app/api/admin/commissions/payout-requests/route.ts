import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, isUuid, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("marketer_payout_requests")
    .select("id,marketer_id,amount,payout_details,status,admin_note,created_at,processed_at,commission_ids")
    .order("created_at", { ascending: false }).limit(200);
  if (error) return dbFail("payout requests", error, "تعذر تحميل طلبات التحويل");
  const ids = Array.from(new Set((data ?? []).map((r) => r.marketer_id)));
  const { data: users, error: userError } = ids.length
    ? await db.from("users").select("id,name,phone").in("id", ids)
    : { data: [], error: null };
  if (userError) return dbFail("payout request users", userError, "تعذر تحميل بيانات المسوّقين");
  const byId = new Map((users ?? []).map((u) => [u.id, u]));
  return ok({ requests: (data ?? []).map((r) => ({ ...r, commission_count: r.commission_ids?.length ?? 0, marketer: byId.get(r.marketer_id) ?? null })) });
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const body = await readJson(req);
  if (!isUuid(body?.id) || !["paid", "rejected"].includes(body?.action)) return fail("طلب التحويل أو الإجراء غير صالح");
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;
  const { data, error } = await getSupabaseAdmin().rpc("admin_process_marketer_payout", {
    p_request_id: body.id, p_action: body.action, p_admin_note: note,
  });
  if (error) return dbFail("process payout request", error, "تعذر معالجة طلب التحويل");
  return ok({ result: data });
}
