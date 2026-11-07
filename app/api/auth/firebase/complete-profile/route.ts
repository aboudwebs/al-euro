import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { signSession } from "@/lib/session";
import { verifyFirebaseIdentityToken } from "@/lib/firebase-auth-admin";
import { verifyRegistrationOtp } from "@/lib/registration-otp";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function digits(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^0-9]/g, "") : "";
}

function canonicalPhone(value: string): string {
  const valueDigits = digits(value);
  if (valueDigits.startsWith("963")) return valueDigits.slice(3);
  if (valueDigits.startsWith("0")) return valueDigits.slice(1);
  return valueDigits;
}

function phoneCandidates(value: string): string[] {
  const valueDigits = digits(value);
  const values = new Set([valueDigits, `+${valueDigits}`]);
  if (valueDigits.startsWith("963")) values.add(`0${valueDigits.slice(3)}`);
  if (valueDigits.startsWith("0")) values.add(`963${valueDigits.slice(1)}`);
  return [...values];
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    if (!idToken || idToken.length > 12_000) return reply({ error: "جلسة تسجيل الدخول غير صالحة" }, 400);
    if (name.length < 2 || name.length > 100) return reply({ error: "الاسم يجب أن يكون بين حرفين و100 حرف" }, 400);
    if (canonicalPhone(phone).length < 8 || !verifyRegistrationOtp(phone, body?.otpCode, body?.otpToken)) {
      return reply({ error: "رمز واتساب غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً." }, 400);
    }

    const identity = await verifyFirebaseIdentityToken(idToken, phone);
    const db = getSupabaseAdmin();
    const { data: linked, error: linkedError } = await db.from("user_auth_identities")
      .select("user_id").eq("provider", identity.provider).eq("provider_uid", identity.uid).maybeSingle();
    if (linkedError || !linked) {
      console.error("[api/auth/firebase/complete-profile] identity lookup:", linkedError);
      return reply({ error: "تعذر مطابقة هوية تسجيل الدخول بحساب EURO" }, 403);
    }

    const { data: user, error: userError } = await db.from("users")
      .select("id, role, name, phone, my_ref_code, is_active, phone_verification_required")
      .eq("id", linked.user_id).maybeSingle();
    if (userError || !user) return reply({ error: "حساب EURO المرتبط غير موجود" }, 404);
    if (!user.is_active) return reply({ pendingApproval: true, error: "حسابك قيد المراجعة من قِبل الإدارة." }, 403);

    const { data: duplicates, error: duplicateError } = await db.from("users")
      .select("id").in("phone", phoneCandidates(phone)).in("role", ["workshop", "marketer"])
      .neq("id", user.id).limit(1);
    if (duplicateError) {
      console.error("[api/auth/firebase/complete-profile] phone lookup:", duplicateError);
      return reply({ error: "تعذر التحقق من رقم الهاتف" }, 500);
    }
    if (duplicates?.length) return reply({ error: "رقم الهاتف مرتبط بحساب EURO آخر. سجّل الدخول بذلك الحساب لربط الهوية." }, 409);

    const { data: updated, error: updateError } = await db.from("users")
      .update({
        name,
        phone: digits(phone),
        phone_verified_at: new Date().toISOString(),
        phone_verification_required: false,
      })
      .eq("id", user.id)
      .select("id, role, name, phone, my_ref_code, is_active")
      .single();
    if (updateError || !updated) {
      console.error("[api/auth/firebase/complete-profile] profile update:", updateError);
      if (updateError?.code === "23505") return reply({ error: "رقم الهاتف مرتبط بحساب آخر" }, 409);
      return reply({ error: "تعذر حفظ بيانات الحساب" }, 500);
    }

    const accessToken = signSession({
      id: String(updated.id),
      role: updated.role,
      name: updated.name ?? "",
      phone: updated.phone ?? "",
      my_ref_code: updated.my_ref_code,
      iat: Date.now(),
    });
    return reply({ ok: true, accessToken, user: updated });
  } catch (error) {
    console.error("[api/auth/firebase/complete-profile] POST:", error);
    const message = error instanceof Error ? error.message : "";
    return reply({ error: message || "حدث خطأ غير متوقع في الخادم" }, 500);
  }
}
