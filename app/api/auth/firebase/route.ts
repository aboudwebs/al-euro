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

function normalizedPhone(value: unknown): string {
  const digits = typeof value === "string" ? value.replace(/[^0-9]/g, "") : "";
  // EURO's existing Syrian records may use local 09... or international 9639... notation.
  if (digits.startsWith("963")) return digits.slice(3);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function phoneLookupCandidates(value: string): string[] {
  const digits = value.replace(/[^0-9]/g, "");
  const candidates = new Set([digits, `+${digits}`]);
  if (digits.startsWith("963")) candidates.add(`0${digits.slice(3)}`);
  if (digits.startsWith("0")) candidates.add(`963${digits.slice(1)}`);
  return [...candidates];
}

/**
 * Exchanges a Firebase ID token for a EURO session.
 * A verified phone is the only cross-provider account matching key. Email is metadata only
 * and is never used to auto-link accounts (including Apple private-relay addresses).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    if (!idToken || idToken.length > 12_000) return reply({ error: "رمز تسجيل الدخول غير صالح" }, 400);

    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const whatsappVerified = Boolean(phone) && verifyRegistrationOtp(phone, body?.otpCode, body?.otpToken);
    if (phone && !whatsappVerified) {
      return reply({ error: "رمز واتساب غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً." }, 400);
    }

    let identity;
    try {
      identity = await verifyFirebaseIdentityToken(idToken, whatsappVerified ? phone : "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("غير مدعومة") || message.includes("توثيق رقم الهاتف")) {
        return reply({ error: message }, 401);
      }
      console.error("[api/auth/firebase] token verification:", error);
      return reply({ error: "تعذر التحقق من هوية Firebase" }, 401);
    }

    const db = getSupabaseAdmin();
    const { data: linked, error: linkedError } = await db
      .from("user_auth_identities")
      .select("user_id, provider, provider_uid")
      .eq("provider", identity.provider)
      .eq("provider_uid", identity.uid)
      .maybeSingle();

    if (linkedError) {
      console.error("[api/auth/firebase] identity lookup:", linkedError);
      return reply({ error: "تحديث قاعدة بيانات تسجيل الدخول مطلوب قبل تفعيل هذه الطريقة" }, 503);
    }

    let userId: string;
    if (linked) {
      userId = String(linked.user_id);
    } else {
      if (!whatsappVerified && !identity.phone) {
        return reply({
          registrationRequired: true,
          provider: identity.provider,
          email: identity.email,
          emailVerified: identity.emailVerified,
        }, 200);
      }
      const phone = normalizedPhone(identity.phone);
      if (!phone) return reply({ error: "رقم الهاتف الموثّق غير صالح" }, 400);

      // Do not guess when legacy data contains the same phone on multiple accounts.
      const { data: matches, error: userLookupError } = await db
        .from("users")
        .select("id, role, name, phone, my_ref_code, is_active")
        .in("phone", phoneLookupCandidates(identity.phone))
        .in("role", ["workshop", "marketer"])
        .limit(2);

      if (userLookupError) {
        console.error("[api/auth/firebase] phone lookup:", userLookupError);
        return reply({ error: "تعذر مطابقة رقم الهاتف مع حساب EURO" }, 500);
      }
      if (!matches?.length) {
        return reply({
          registrationRequired: true,
          verifiedPhone: identity.phone,
          provider: identity.provider,
          email: identity.email,
          emailVerified: identity.emailVerified,
        }, 200);
      }
      if (matches.length !== 1) {
        return reply({ error: "يوجد أكثر من حساب مرتبط بهذا الرقم. تواصل مع الإدارة لربط الحساب بأمان." }, 409);
      }

      const matchedUser = matches[0];
      userId = String(matchedUser.id);
      const { error: identityInsertError } = await db.from("user_auth_identities").insert({
        user_id: userId,
        provider: identity.provider,
        provider_uid: identity.uid,
        email: identity.email,
        email_verified: identity.emailVerified,
      });
      if (identityInsertError && identityInsertError.code !== "23505") {
        console.error("[api/auth/firebase] identity insert:", identityInsertError);
        return reply({ error: "تعذر حفظ ربط طريقة الدخول بالحساب" }, 503);
      }
    }

    const { data: user, error: userError } = await db
      .from("users")
      .select("id, role, name, phone, my_ref_code, is_active")
      .eq("id", userId)
      .maybeSingle();
    if (userError || !user) {
      console.error("[api/auth/firebase] EURO account lookup:", userError);
      return reply({ error: "حساب EURO المرتبط غير موجود" }, 404);
    }

    if (identity.phone && user.phone && normalizedPhone(user.phone) !== normalizedPhone(identity.phone)) {
      return reply({ error: "رقم الهاتف الموثّق لا يطابق رقم الحساب. تواصل مع الإدارة." }, 403);
    }
    if (!user.is_active) {
      return reply({
        pendingApproval: true,
        error: "حسابك قيد المراجعة من قِبل الإدارة، وسيتم تفعيله بعد التحقق من البيانات.",
      }, 403);
    }
    if (user.role !== "workshop" && user.role !== "marketer") {
      return reply({ error: "هذه الطريقة مخصصة لحسابات الورشات والمسوّقين" }, 403);
    }

    if (whatsappVerified || (identity.provider === "phone" && identity.phone)) {
      const { error: verificationUpdateError } = await db.from("users")
        .update({ phone_verified_at: new Date().toISOString(), phone_verification_required: false })
        .eq("id", user.id);
      if (verificationUpdateError) {
        console.error("[api/auth/firebase] phone verification update:", verificationUpdateError);
        return reply({ error: "تحديث قاعدة بيانات التحقق مطلوب قبل إكمال الدخول" }, 503);
      }
    }

    const accessToken = signSession({
      id: String(user.id),
      role: user.role,
      name: user.name,
      phone: user.phone,
      my_ref_code: user.my_ref_code,
      iat: Date.now(),
    });
    return reply({
      ok: true,
      accessToken,
      user: {
        id: user.id,
        role: user.role,
        name: user.name,
        phone: user.phone,
        my_ref_code: user.my_ref_code,
        is_active: user.is_active,
      },
    });
  } catch (error) {
    console.error("[api/auth/firebase] POST:", error);
    return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
  }
}
