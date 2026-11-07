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
      .select("id, role, name, phone, my_ref_code, is_active")
      .in("phone", phoneCandidates(phone)).in("role", ["workshop", "marketer"])
      .neq("id", user.id).limit(2);
    if (duplicateError) {
      console.error("[api/auth/firebase/complete-profile] phone lookup:", duplicateError);
      return reply({ error: "تعذر التحقق من رقم الهاتف" }, 500);
    }
    if ((duplicates?.length ?? 0) > 1) {
      return reply({ error: "يوجد أكثر من حساب مرتبط بهذا الرقم. تواصل مع الإدارة لربط الحساب بأمان." }, 409);
    }

    let updated: any;
    const existingPhoneAccount = duplicates?.[0];
    if (existingPhoneAccount) {
      // The WhatsApp OTP proves ownership of the legacy phone account. Link this exact
      // provider UID to that account; never use email as a matching key.
      if (existingPhoneAccount.role !== user.role) {
        return reply({ error: "نوع الحساب لا يطابق الحساب المرتبط بهذا الرقم. تواصل مع الدعم." }, 409);
      }
      if (!existingPhoneAccount.is_active) {
        return reply({ pendingApproval: true, error: "الحساب المرتبط بهذا الرقم قيد مراجعة الإدارة." }, 403);
      }

      const { error: identityMoveError } = await db.from("user_auth_identities")
        .update({ user_id: existingPhoneAccount.id })
        .eq("provider", identity.provider)
        .eq("provider_uid", identity.uid)
        .eq("user_id", user.id);
      if (identityMoveError) {
        console.error("[api/auth/firebase/complete-profile] safe identity link:", identityMoveError);
        return reply({ error: "تعذر ربط طريقة الدخول بالحساب القديم" }, 503);
      }

      const { data: legacyUpdated, error: legacyUpdateError } = await db.from("users")
        .update({
          name: existingPhoneAccount.name || name,
          phone_verified_at: new Date().toISOString(),
          phone_verification_required: false,
        })
        .eq("id", existingPhoneAccount.id)
        .select("id, role, name, phone, my_ref_code, is_active")
        .single();
      if (legacyUpdateError || !legacyUpdated) {
        console.error("[api/auth/firebase/complete-profile] legacy account update:", legacyUpdateError);
        return reply({ error: "تم ربط الهوية لكن تعذر تحديث حالة التوثيق. أعد تسجيل الدخول." }, 503);
      }
      updated = legacyUpdated;
      await db.from("users").update({ is_active: false }).eq("id", user.id);
    } else {
      const { data: profileUpdated, error: updateError } = await db.from("users")
        .update({
          name,
          phone: digits(phone),
          phone_verified_at: new Date().toISOString(),
          phone_verification_required: false,
        })
        .eq("id", user.id)
        .select("id, role, name, phone, my_ref_code, is_active")
        .single();
      if (updateError || !profileUpdated) {
        console.error("[api/auth/firebase/complete-profile] profile update:", updateError);
        if (updateError?.code === "23505") return reply({ error: "رقم الهاتف مرتبط بحساب آخر" }, 409);
        return reply({ error: "تعذر حفظ بيانات الحساب" }, 500);
      }
      updated = profileUpdated;
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
