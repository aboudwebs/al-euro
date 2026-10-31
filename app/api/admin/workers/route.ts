import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashPassword } from "@/lib/session";

export const dynamic = "force-dynamic";

const FIELDS = "id, name, phone, is_active, created_at";

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { data, error } = await getSupabaseAdmin()
    .from("users").select(FIELDS).eq("role", "worker")
    .order("created_at", { ascending: false });
  if (error) return dbFail("workers list", error, "تعذر تحميل حسابات الموظفين");
  return ok({ workers: data ?? [] });
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const body = await readJson(req);
  if (!body) return fail("بيانات غير صالحة");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (name.length < 2 || name.length > 100) return fail("الاسم يجب أن يكون بين حرفين و100 حرف");
  if (phone.length < 8 || phone.length > 20) return fail("رقم الهاتف غير صالح");
  if (password.length < 8 || password.length > 128) return fail("كلمة المرور يجب أن تكون 8 أحرف على الأقل");

  const db = getSupabaseAdmin();
  const { data: existing, error: lookupError } = await db.from("users")
    .select("id").eq("phone", phone).eq("role", "worker").maybeSingle();
  if (lookupError) return dbFail("worker lookup", lookupError, "تعذر التحقق من رقم الهاتف");
  if (existing) return fail("يوجد حساب موظف مسجل بهذا الرقم مسبقاً");

  const { data, error } = await db.from("users").insert({
    role: "worker",
    name,
    phone,
    password_hash: hashPassword(password),
    is_active: true,
    city: null,
    license: null,
    specs: [],
    debt_limit: 0,
    debt_balance: 0,
    cashback_balance: 0,
    my_ref_code: null,
    referred_by_code: null,
  }).select(FIELDS).single();
  if (error?.code === "23505") return fail("رقم الهاتف مستخدم مسبقاً");
  if (error) return dbFail("worker create", error, "تعذر إنشاء حساب الموظف");
  return ok({ worker: data }, 201);
}
