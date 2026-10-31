import { requireAdmin } from "@/lib/admin-guard";
import { clampLimit, cleanSearch, dbFail, ok, signStored } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { SPECIAL_STATUSES, splitRequestNotes } from "@/lib/status";

export const dynamic = "force-dynamic";

/** ?status=new|priced|ordered|completed|cancelled  ?q=  */
export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const q = cleanSearch(url.searchParams.get("q"));

  let query = getSupabaseAdmin().from("special_requests").select("*");
  if (status && (SPECIAL_STATUSES as string[]).includes(status)) query = query.eq("status", status);
  if (q) query = query.or(`customer_name.ilike.*${q}*,customer_phone.ilike.*${q}*,part_name.ilike.*${q}*,vin_or_oem.ilike.*${q}*`);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(clampLimit(url.searchParams.get("limit")));
  if (error) return dbFail("requests list", error, "تعذر تحميل الطلبات الخاصة");

  const signed = await signStored("special-requests", (data ?? []).map((r) => r.image_url));
  const requests = (data ?? []).map(({ image_url, notes, ...r }) => {
    const split = splitRequestNotes(notes);
    return { ...r, customer_notes: split.customer, admin_note: split.admin, image_signed_url: image_url ? signed[image_url] ?? null : null };
  });
  return ok({ requests });
}
