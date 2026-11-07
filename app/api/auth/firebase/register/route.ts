import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { signSession, safeEqual, hashPassword } from "@/lib/session";
import { verifyFirebaseIdentityToken } from "@/lib/firebase-auth-admin";\nimport { verifyRegistrationOtp } from "@/lib/registration-otp";
import { notifyUser } from "@/lib/push";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function phoneDigits(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^0-9]/g, "") : "";
}

function canonicalPhone(value: unknown): string {
  const digits = phoneDigits(value);
  if (digits.startsWith("963")) return digits.slice(3);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function phoneCandidates(value: string): string[] {
  const digits = phoneDigits(value);
  const values = new Set([digits, `+${digits}`]);
  if (digits.startsWith("963")) values.add(`0${digits.slice(3)}`);
  if (digits.startsWith("0")) values.add(`963${digits.slice(1)}`);
  return [...values];
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    if (!idToken || idToken.length > 12_000) return reply({ error: "رمز تسجيل الدخول غير صالح" }, 400);

    let identity;
    try {
      identity = await verifyFirebaseIdentityToken(idToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return reply({ error: message || "تعذر التحقق من هوية Firebase" }, 401);
    }

    const role = body?.role;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const license = typeof body?.license === "string" ? body.license.trim() : "";
    const city = typeof body?.city === "string" ? body.city.trim() : "";
    const spec = typeof body?.spec === "string" ? body.spec.trim() : "";
    const manualVerification = body?.manualVerification === true;
    const refCode = typeof body?.refCode === "string" ? body.refCode.trim().slice(0, 80) : "";
    const refSignature = typeof body?.refSignature === "string" ? body.refSignature.trim() : "";

    if (role !== "workshop" && role !== "marketer") {
      return reply({ error: "اختر نوع الحساب: ورشة أو مسوّق" }, 400);
    }
    if (name.length < 2 || name.length > 100) return reply({ error: "الاسم يجب أن يكون بين حرفين و100 حرف" }, 400);
    if (role === "workshop" && ((!license && !manualVerification) || !city || !spec)) {
      return reply({ error: "أدخل الترخيص أو اختر التحقق اليدوي، وحدد المدينة والاختصاص" }, 400);
    }

    const db = getSupabaseAdmin();
    const phone = phoneDigits(identity.phone);
    if (!phone || canonicalPhone(phone).length < 8) return reply({ error: "رقم الهاتف الموثّق غير صالح" }, 400);

    const { data: existing, error: existingError } = await db.from("users")
      .select("id")
      .in("phone", phoneCandidates(identity.phone))
      .in("role", ["workshop", "marketer"])
      .limit(1);
    if (existingError) {
      console.error("[api/auth/firebase/register] existing phone lookup:", existingError);
      return reply({ error: "تعذر التحقق من رقم الهاتف" }, 500);
    }
    if (existing?.length) return reply({ error: "هذا الرقم مرتبط بحساب EURO موجود. استخدم تسجيل الدخول لربط هويتك." }, 409);

    let validatedReferralCode: string | null = null;
    if (role === "workshop" && refCode) {
      if (refSignature) {
        const expected = crypto.createHmac("sha256", process.env.AUTH_SECRET || "")
          .update(`workshop-referral:${refCode}`).digest("hex");
        if (!safeEqual(expected, refSignature)) {
          return reply({ error: "كود الإحالة مثبت من رابط المسوّق ولا يمكن تغييره" }, 400);
        }
      }
      const { data: referrer, error } = await db.from("users")
        .select("id").eq("role", "marketer").eq("my_ref_code", refCode).eq("is_active", true).maybeSingle();
      if (error) {
        console.error("[api/auth/firebase/register] referral lookup:", error);
        return reply({ error: "تعذر التحقق من كود الإحالة" }, 500);
      }
      if (!referrer) return reply({ error: "كود الإحالة غير صحيح أو حساب المسوّق غير مفعّل" }, 400);
      validatedReferralCode = refCode;
    } else if (role === "workshop" && refSignature) {
      return reply({ error: "رابط الإحالة غير مكتمل؛ افتح رابط المسوّق من جديد" }, 400);
    }

    const specs = spec ? spec.split(/[,،]/).map((item: string) => item.trim()).filter(Boolean) : [];
    let created: any = null;
    let createError: any = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const myRefCode = role === "marketer" ? `MK-${crypto.randomBytes(3).toString("hex").toUpperCase()}` : null;
      const result = await db.from("users").insert({
        role,
        name,
        phone,
        password_hash: hashPassword(crypto.randomBytes(32).toString("base64url")),
        license: role === "workshop" ? (license || null) : null,
        license_verification_status: role === "workshop" && !license ? "pending" : null,
        city: city || null,
        specs,
        my_ref_code: myRefCode,
        referred_by_code: validatedReferralCode,
        tier: role === "workshop" ? "Standard" : undefined,
        is_active: role !== "workshop",
        phone_verified_at: new Date().toISOString(),
        phone_verification_required: false,
      }).select("id, role, name, phone, my_ref_code, is_active, tier, city, license, license_verification_status, specs, created_at").single();

      if (!result.error) {
        created = result.data;
        createError = null;
        break;
      }
      createError = result.error;
      if (!(result.error.code === "23505" && result.error.message?.includes("my_ref_code"))) break;
    }

    if (createError || !created) {
      console.error("[api/auth/firebase/register] user insert:", createError);
      if (createError?.code === "23505") return reply({ error: "هذا الرقم مسجل مسبقاً أو تعذر إنشاء الحساب" }, 409);
      if (createError?.code === "42703" || createError?.code === "PGRST204" || createError?.code === "42P01" || createError?.code === "PGRST205") {
        return reply({ error: "يجب تطبيق تحديث قاعدة بيانات تسجيل الدخول قبل إنشاء الحسابات الجديدة" }, 503);
      }
      return reply({ error: "تعذر إنشاء الحساب" }, 500);
    }

    const { error: identityError } = await db.from("user_auth_identities").insert({
      user_id: created.id,
      provider: identity.provider,
      provider_uid: identity.uid,
      email: identity.email,
      email_verified: identity.emailVerified,
    });
    if (identityError) {
      console.error("[api/auth/firebase/register] identity insert:", identityError);
      await db.from("users").delete().eq("id", created.id);
      if (identityError.code === "23505") return reply({ error: "طريقة الدخول مرتبطة بحساب آخر. سجّل الدخول بالحساب المرتبط." }, 409);
      if (identityError.code === "42P01" || identityError.code === "PGRST205") {
        return reply({ error: "يجب تطبيق تحديث قاعدة بيانات تسجيل الدخول قبل إنشاء الحسابات الجديدة" }, 503);
      }
      return reply({ error: "تعذر حفظ هوية تسجيل الدخول" }, 500);
    }

    if (validatedReferralCode) {
      const { data: referrer } = await db.from("users").select("id")
        .eq("role", "marketer").eq("my_ref_code", validatedReferralCode).maybeSingle();
      if (referrer) {
        await notifyUser({
          userId: String(referrer.id),
          type: "referral_new",
          title: "إحالة جديدة",
          body: "انضم مستخدم جديد عبر رابطك",
          eventKey: `referral:user:${created.id}`,
          data: { screen: "dashboard", referralUserId: String(created.id) },
        });
      }
    }

    if (role === "workshop") {
      return reply({
        ok: true,
        pendingApproval: true,
        message: "تم إرسال طلب تسجيل الورشة للإدارة. سيتم تفعيل الحساب بعد مراجعة البيانات.",
      });
    }

    const accessToken = signSession({
      id: String(created.id),
      role: created.role,
      name: created.name,
      phone: created.phone,
      my_ref_code: created.my_ref_code,
      iat: Date.now(),
    });
    return reply({ ok: true, accessToken, user: created });
  } catch (error) {
    console.error("[api/auth/firebase/register] POST:", error);
    return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
  }
}
