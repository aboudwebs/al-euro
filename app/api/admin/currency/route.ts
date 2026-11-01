import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { data, error } = await getSupabaseAdmin().from("app_settings").select("value,updated_at").eq("key", "usd_to_syp").maybeSingle();
  if (error) return dbFail("currency setting", error, "تعذر تحميل سعر الصرف");
  const rate = Number(String(data?.value ?? "").replace(/,/g, "").trim());
  return ok({ usdToSyp: Number.isFinite(rate) && rate > 0 ? rate : null, updatedAt: data?.updated_at ?? null });
}

export async function PUT(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const body = await readJson(req);
  const rate = Number(body?.usdToSyp);
  if (!Number.isFinite(rate) || rate < 1 || rate > 1_000_000_000) return fail("أدخل سعر صرف صحيحاً بين 1 و1,000,000,000");
  const { data, error } = await getSupabaseAdmin().from("app_settings")
    .upsert({ key: "usd_to_syp", value: String(rate), updated_at: new Date().toISOString() }, { onConflict: "key" })
    .select("value,updated_at").single();
  if (error) return dbFail("currency update", error, "تعذر حفظ سعر الصرف");
  return ok({ usdToSyp: Number(data.value), updatedAt: data.updated_at });
}
