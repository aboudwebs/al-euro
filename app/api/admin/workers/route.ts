import { requireAdmin } from "@/lib/admin-guard";
import { dbFail, fail, ok, readJson } from "@/lib/admin-api";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashPassword } from "@/lib/session";
import crypto from "crypto";

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

  const password = typeof body.password === "string" ? body.password : "";
  if (name.length < 2 || name.length > 100) return fail("الاسم يجب أن يكون بين حرفين و100 حرف");
  if (password.length < 8 || password.length > 128) return fail("كلمة المرور يجب أن تكون 8 أحرف على الأقل");

  const db = getSupabaseAdmin();
  let data: Record<string, unknown> | null = null;
  let createError: { code?: string; message?: string } | null = null;

  // Generate a unique 9-digit employee ID. It is stored in the existing phone
  // column for workers only, so no database schema change is required.
  for (let attempt = 0; attempt < 10; attempt++) {
    const employeeId = String(crypto.randomInt(100000000, 1000000000));
    const { data: existing, error: lookupError } = await db.from("users")
      .select("id").eq("phone", employeeId).maybeSingle();
    if (lookupError) return dbFail("worker ID lookup", lookupError, "تعذر إنشاء معرّف الموظف");

    if (existing) continue;

    const result = await db.from("users").insert({
      role: "worker",
      name,
      phone: employeeId,
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

    if (!result.error) {
      data = result.data;
      createError = null;
      break;
    }
    createError = result.error;
    if (result.error.code !== "23505") break;
  }

  if (!data) {
    if (createError?.code === "23505") return fail("تعذر توليد معرّف فريد، حاول مرة أخرى");
    if (createError) return dbFail("worker create", createError, "تعذر إنشاء حساب الموظف");
    return fail("تعذر توليد معرّف فريد، حاول مرة أخرى");
  }
  return ok({ worker: data }, 201);
}
