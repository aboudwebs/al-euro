import { getSupabaseAdmin } from "@/lib/supabase";
import { hashPassword, safeEqual } from "@/lib/session";
import { DELETION_GRACE_DAYS } from "@/lib/account-deletion";
import { dbError, readBody, reply, requireUser } from "@/lib/account-api";

export const dynamic = "force-dynamic";

const FIELDS = "id, requested_at, due_at";

function requestJson(r: { requested_at: string; due_at: string }) {
  return { requestedAt: r.requested_at, dueAt: r.due_at, graceDays: DELETION_GRACE_DAYS };
}

/** { request: null } when nothing is pending, otherwise { request: { requestedAt, dueAt } }. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data, error } = await getSupabaseAdmin()
    .from("account_deletion_requests").select(FIELDS).eq("user_id", auth.user.id).eq("status", "pending").maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return reply({ request: null, ready: false });
    return dbError("deletion status", error, "تعذر قراءة حالة الحذف");
  }
  return reply({ request: data ? requestJson(data) : null, ready: true });
}

/** Body: { password }. Starts the 30-day countdown; the account keeps working until it ends and can cancel any time. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!safeEqual(String(auth.user.password_hash ?? ""), hashPassword(password))) {
    return reply({ error: "كلمة المرور غير صحيحة" }, 403);
  }

  const db = getSupabaseAdmin();

  // Money and orders in progress must be settled first (the accounting records stay, see process_account_deletions()).
  if (Number(auth.user.debt_balance ?? 0) > 0) {
    return reply({ error: "لا يمكن طلب حذف الحساب وعليه رصيد دين. سدّد الرصيد أو تواصل مع الإدارة." }, 409);
  }
  const { count: active, error: activeError } = await db
    .from("orders").select("id", { count: "exact", head: true }).eq("user_id", auth.user.id).in("status", ["pending", "approved", "shipped"]);
  if (activeError) return dbError("deletion orders check", activeError, "تعذر التحقق من الطلبات");
  if ((active ?? 0) > 0) return reply({ error: "لديك طلبات قيد التنفيذ. انتظر اكتمالها أو إلغاءها ثم أعد المحاولة." }, 409);
  if (auth.user.role === "marketer") {
    const { count: owed, error: owedError } = await db
      .from("marketer_commissions").select("id", { count: "exact", head: true }).eq("marketer_id", auth.user.id).in("status", ["held", "available"]);
    if (owedError) return dbError("deletion commissions check", owedError, "تعذر التحقق من العمولات");
    if ((owed ?? 0) > 0) return reply({ error: "لديك عمولات غير مدفوعة. تواصل مع الإدارة لتسويتها قبل حذف الحساب." }, 409);
  }

  const { data: existing, error: existingError } = await db
    .from("account_deletion_requests").select(FIELDS).eq("user_id", auth.user.id).eq("status", "pending").maybeSingle();
  if (existingError) return dbError("deletion existing", existingError, "تعذر حفظ الطلب");
  if (existing) return reply({ ok: true, request: requestJson(existing) });

  const due = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("account_deletion_requests").insert({ user_id: auth.user.id, due_at: due }).select(FIELDS).single();
  if (error?.code === "23505") {
    // Two taps at once: the other request won, return it.
    const { data: again } = await db.from("account_deletion_requests").select(FIELDS).eq("user_id", auth.user.id).eq("status", "pending").maybeSingle();
    if (again) return reply({ ok: true, request: requestJson(again) });
  }
  if (error || !data) return dbError("deletion insert", error, "تعذر حفظ الطلب");
  return reply({ ok: true, request: requestJson(data) }, 201);
}

/** Cancels the pending request (only while its 30 days have not ended). */
export async function DELETE() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data, error } = await getSupabaseAdmin()
    .from("account_deletion_requests")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("user_id", auth.user.id)
    .eq("status", "pending")
    .gt("due_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (error) return dbError("deletion cancel", error, "تعذر إلغاء الطلب");
  if (!data) return reply({ error: "لا يوجد طلب حذف قابل للإلغاء" }, 404);
  return reply({ ok: true });
}
