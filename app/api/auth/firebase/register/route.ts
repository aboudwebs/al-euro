import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { mintAccessToken, hashPassword } from "@/lib/session";
import { verifyFirebaseIdentityToken } from "@/lib/firebase-auth-admin";
import { claimRegistrationOtp, type OtpClaim } from "@/lib/registration-otp";
import { notifyUser } from "@/lib/push";
import { verifyReferralSignature } from "@/lib/referral-signature";
import { RULES, rateHit, rateKey, tooManyRequests } from "@/lib/rate-limit";
import { BodyTooLargeError, clientIp, readJsonLimited } from "@/lib/http";
import { recordReferralSignup } from "@/lib/referral-guard";
import { newPasswordError } from "@/lib/password-policy";

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
  // An SMS code that was accepted but not used up (the sign-up then failed) is given back in `finally`.
  let otpClaim: OtpClaim | null = null;
  let otpSpent = false;
  try {
    const ip = clientIp(req);
    const limited = await rateHit(rateKey("register-ip", ip), RULES.registerPerIp);
    if (!limited.allowed) return tooManyRequests(limited.retryAfter);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = await readJsonLimited(req);
    } catch (error) {
      return reply({ error: error instanceof BodyTooLargeError ? "حجم الطلب كبير جداً" : "بيانات الطلب غير صالحة" }, error instanceof BodyTooLargeError ? 413 : 400);
    }
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    if (!idToken || idToken.length > 12_000) return reply({ error: "رمز تسجيل الدخول غير صالح" }, 400);

    const verifiedPhone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const contactPhone = typeof body?.contactPhone === "string" ? body.contactPhone.trim() : "";

    // OAuth registration stores a workshop contact number without treating it as phone-verified.
    // Phone verification remains a separate checkout requirement.
    if (!verifiedPhone) {
      let identity;
      try {
        identity = await verifyFirebaseIdentityToken(idToken);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        // Only our own Arabic messages reach the client; internal provider errors are logged, never returned.
        if (message.includes("غير مدعومة") || message.includes("توثيق رقم الهاتف")) return reply({ error: message }, 401);
        console.error("[api/auth/firebase/register] token verification:", error);
        return reply({ error: "تعذر التحقق من هوية Firebase" }, 401);
      }

      const role = body?.role;
      if (role !== "workshop" && role !== "marketer" && role !== "customer") {
        return reply({ error: "اختر نوع الحساب بشكل صحيح" }, 400);
      }
      const workshopPhone = phoneDigits(contactPhone);
      if (role === "workshop" && canonicalPhone(workshopPhone).length < 8) {
        return reply({ error: "رقم هاتف الورشة إلزامي ويجب أن يكون صحيحاً" }, 400);
      }
      if (role === "customer" && workshopPhone && canonicalPhone(workshopPhone).length < 8) {
        return reply({ error: "رقم الهاتف غير صحيح" }, 400);
      }


      const db = getSupabaseAdmin();
      const { data: linked, error: linkedError } = await db.from("user_auth_identities")
        .select("user_id").eq("provider", identity.provider).eq("provider_uid", identity.uid).maybeSingle();
      if (linkedError) {
        console.error("[api/auth/firebase/register] identity lookup:", linkedError);
        return reply({ error: "تعذر التحقق من هوية الحساب" }, 503);
      }
      if (linked) {
        const { data: existingUser, error } = await db.from("users")
          .select("id, role, name, phone, phone_verified_at, phone_verification_required, my_ref_code, is_active").eq("id", linked.user_id).maybeSingle();
        if (error || !existingUser) return reply({ error: "حساب EURO المرتبط غير موجود" }, 404);
        if (existingUser.role !== role) {
          return reply({ error: "طريقة Google مرتبطة مسبقاً بنوع حساب آخر. سجّل الدخول بنوع الحساب المرتبط." }, 409);
        }
        if (role === "customer" && workshopPhone && canonicalPhone(existingUser.phone) !== canonicalPhone(workshopPhone)) {
          return reply({ error: "حساب Google مرتبط برقم هاتف مختلف. استخدم تسجيل الدخول أو تواصل مع الدعم لتغيير الرقم." }, 409);
        }
        if (!existingUser.is_active) return reply({ pendingApproval: true, message: "حسابك قيد المراجعة من قِبل الإدارة." }, 403);
        const accessToken = await mintAccessToken({
          id: String(existingUser.id), role: existingUser.role, name: existingUser.name ?? "",
          phone: existingUser.phone ?? "", my_ref_code: existingUser.my_ref_code,
        });
        return reply({ ok: true, accessToken, user: existingUser, phoneVerificationRequired: Boolean(existingUser.phone_verification_required) });
      }

      const refCode = typeof body?.refCode === "string" ? body.refCode.trim().slice(0, 80) : "";
      const refSignature = typeof body?.refSignature === "string" ? body.refSignature.trim() : "";
      let validatedReferralCode: string | null = null;
      if (role === "workshop" && refCode) {
        if (refSignature && !verifyReferralSignature(refCode, refSignature)) return reply({ error: "كود الإحالة غير صالح" }, 400);
        const { data: referrer, error } = await db.from("users").select("id")
          .eq("role", "marketer").eq("my_ref_code", refCode).eq("is_active", true).maybeSingle();
        if (error || !referrer) return reply({ error: "كود الإحالة غير صحيح أو حساب المسوّق غير مفعّل" }, 400);
        validatedReferralCode = refCode;
      } else if (role === "workshop" && refSignature) {
        return reply({ error: "رابط الإحالة غير مكتمل؛ افتح رابط المسوّق من جديد" }, 400);
      }

      const optionalName = typeof body?.name === "string" ? body.name.trim() : "";
      const customerPassword = typeof body?.password === "string" ? body.password : "";
      if (role === "customer" && (optionalName.length < 2 || optionalName.length > 100)) return reply({ error: "الاسم يجب أن يكون بين حرفين و100 حرف" }, 400);
      if (role === "customer" && customerPassword) {
        const passwordError = newPasswordError(customerPassword);
        if (passwordError) return reply({ error: passwordError }, 400);
      }
      const optionalCity = typeof body?.city === "string" ? body.city.trim() : "";
      const optionalSpec = typeof body?.spec === "string" ? body.spec.trim() : "";
      const optionalLicense = typeof body?.license === "string" ? body.license.trim() : "";
      const specs = optionalSpec ? optionalSpec.split(/[,،]/).map((item: string) => item.trim()).filter(Boolean) : [];
      if (role === "workshop" || (role === "customer" && workshopPhone)) {
        const { data: duplicatePhone, error: duplicatePhoneError } = await db.from("users")
          .select("id").in("phone", phoneCandidates(workshopPhone)).in("role", ["workshop", "marketer", "customer"]).limit(1);
        if (duplicatePhoneError) {
          console.error("[api/auth/firebase/register] contact phone lookup:", duplicatePhoneError);
          return reply({ error: "تعذر التحقق من رقم الهاتف" }, 500);
        }
        if (duplicatePhone?.length) return reply({ error: "رقم الهاتف مرتبط بحساب EURO موجود" }, 409);
      }
      let created: any = null;
      let createError: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const myRefCode = role === "marketer" ? `MK-${crypto.randomBytes(3).toString("hex").toUpperCase()}` : null;
        const result = await db.from("users").insert({
          role,
          name: optionalName.length >= 2 ? optionalName : null,
          phone: role === "workshop" ? workshopPhone : role === "customer" && workshopPhone ? workshopPhone : null,
          password_hash: role === "customer" && customerPassword ? hashPassword(customerPassword) : null,
          license: role === "workshop" ? (optionalLicense || null) : null,
          license_verification_status: role === "workshop" && !optionalLicense ? "pending" : null,
          city: optionalCity || null,
          specs,
          my_ref_code: myRefCode,
          referred_by_code: validatedReferralCode,
          tier: role === "customer" ? null : role === "workshop" ? "Standard" : undefined,
          is_active: role !== "workshop",
          phone_verified_at: null,
          phone_verification_required: true,
          debt_limit: role === "customer" ? 0 : undefined,
          debt_balance: role === "customer" ? 0 : undefined,
          cashback_balance: role === "customer" ? 0 : undefined,
        }).select("id, role, name, phone, my_ref_code, is_active, tier, city, license, license_verification_status, specs, created_at").single();
        if (!result.error) { created = result.data; createError = null; break; }
        createError = result.error;
        if (!(result.error.code === "23505" && result.error.message?.includes("my_ref_code"))) break;
      }
      if (createError || !created) {
        console.error("[api/auth/firebase/register] incomplete user insert:", createError);
        return reply({ error: "تعذر إنشاء الحساب" }, 500);
      }

      const { error: identityError } = await db.from("user_auth_identities").insert({
        user_id: created.id, provider: identity.provider, provider_uid: identity.uid,
        email: identity.email, email_verified: identity.emailVerified,
      });
      if (identityError) {
        console.error("[api/auth/firebase/register] identity insert:", identityError);
        await db.from("users").delete().eq("id", created.id);
        return reply({ error: identityError.code === "23505" ? "طريقة الدخول مرتبطة بحساب آخر." : "تعذر حفظ هوية تسجيل الدخول" }, identityError.code === "23505" ? 409 : 500);
      }

      if (validatedReferralCode) {
        await recordReferralSignup({ newUserId: String(created.id), newUserPhone: workshopPhone, referralCode: validatedReferralCode, ip });
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
        return reply({ ok: true, pendingApproval: true, message: "تم إنشاء الحساب وإرسال طلب الورشة للمراجعة. أكمل توثيق الهاتف عند أول شراء." });
      }
      const accessToken = await mintAccessToken({
        id: String(created.id), role: created.role, name: created.name ?? "",
        phone: created.phone ?? "", my_ref_code: created.my_ref_code,
      });
      return reply({ ok: true, accessToken, user: role === "customer" ? { id: created.id, role: created.role, name: created.name, phone: created.phone, is_active: created.is_active, created_at: created.created_at } : created, phoneVerificationRequired: role !== "customer" });
    }

    const otpLimited = await rateHit(rateKey("otp-verify-ip", ip), RULES.otpVerifyPerIp);
    if (!otpLimited.allowed) return tooManyRequests(otpLimited.retryAfter);
    otpClaim = await claimRegistrationOtp(verifiedPhone, body?.otpCode, body?.otpToken);
    if (!otpClaim.ok) {
      return otpClaim.reason === "failed"
        ? reply({ error: "تعذر التحقق من الرمز حالياً، حاول لاحقاً" }, 503)
        : reply({ error: "رمز التحقق غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً." }, 400);
    }

    let identity;
    try {
      identity = await verifyFirebaseIdentityToken(idToken, verifiedPhone);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("غير مدعومة") || message.includes("توثيق رقم الهاتف")) return reply({ error: message }, 401);
      console.error("[api/auth/firebase/register] token verification:", error);
      return reply({ error: "تعذر التحقق من هوية Firebase" }, 401);
    }

    const role = body?.role;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const accountPassword = typeof body?.password === "string" ? body.password : "";
    const license = typeof body?.license === "string" ? body.license.trim() : "";
    const city = typeof body?.city === "string" ? body.city.trim() : "";
    const spec = typeof body?.spec === "string" ? body.spec.trim() : "";
    const manualVerification = body?.manualVerification === true;
    const refCode = typeof body?.refCode === "string" ? body.refCode.trim().slice(0, 80) : "";
    const refSignature = typeof body?.refSignature === "string" ? body.refSignature.trim() : "";

    if (role !== "workshop" && role !== "marketer" && role !== "customer") {
      return reply({ error: "اختر نوع الحساب بشكل صحيح" }, 400);
    }
    if (name.length < 2 || name.length > 100) return reply({ error: "الاسم يجب أن يكون بين حرفين و100 حرف" }, 400);
    const passwordError = newPasswordError(accountPassword);
    if (passwordError) return reply({ error: passwordError }, 400);
    if (role === "workshop" && ((!license && !manualVerification) || !city || !spec)) {
      return reply({ error: "أدخل الترخيص أو اختر التحقق اليدوي، وحدد المدينة والاختصاص" }, 400);
    }

    const db = getSupabaseAdmin();
    const phone = phoneDigits(identity.phone);
    if (!phone || canonicalPhone(phone).length < 8) return reply({ error: "رقم الهاتف الموثّق غير صالح" }, 400);

    const { data: existing, error: existingError } = await db.from("users")
      .select("id")
      .in("phone", phoneCandidates(identity.phone))
      .in("role", ["workshop", "marketer", "customer"])
      .limit(1);
    if (existingError) {
      console.error("[api/auth/firebase/register] existing phone lookup:", existingError);
      return reply({ error: "تعذر التحقق من رقم الهاتف" }, 500);
    }
    if (existing?.length) return reply({ error: "هذا الرقم مرتبط بحساب EURO موجود. استخدم تسجيل الدخول لربط هويتك." }, 409);

    let validatedReferralCode: string | null = null;
    if (role === "workshop" && refCode) {
      if (refSignature && !verifyReferralSignature(refCode, refSignature)) {
        return reply({ error: "كود الإحالة مثبت من رابط المسوّق ولا يمكن تغييره" }, 400);
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
        password_hash: hashPassword(accountPassword),
        license: role === "workshop" ? (license || null) : null,
        license_verification_status: role === "workshop" && !license ? "pending" : null,
        city: city || null,
        specs,
        my_ref_code: myRefCode,
        referred_by_code: validatedReferralCode,
        tier: role === "customer" ? null : role === "workshop" ? "Standard" : undefined,
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
    otpSpent = true;

    if (validatedReferralCode) {
      await recordReferralSignup({ newUserId: String(created.id), newUserPhone: phone, referralCode: validatedReferralCode, ip });
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

    const accessToken = await mintAccessToken({
      id: String(created.id),
      role: created.role,
      name: created.name,
      phone: created.phone,
      my_ref_code: created.my_ref_code,
    });
    return reply({ ok: true, accessToken, user: role === "customer" ? { id: created.id, role: created.role, name: created.name, phone: created.phone, is_active: created.is_active, created_at: created.created_at } : created });
  } catch (error) {
    console.error("[api/auth/firebase/register] POST:", error);
    return reply({ error: "حدث خطأ غير متوقع في الخادم" }, 500);
  } finally {
    if (otpClaim?.ok && !otpSpent) await otpClaim.release();
  }
}
