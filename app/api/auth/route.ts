import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  SessionStoreError,
  bumpTokenVersion,
  clearSession,
  getSession,
  hashPassword,
  isLegacyPasswordHash,
  setSession,
  verifyPassword,
} from "@/lib/session";
import { finalizeDueDeletion } from "@/lib/account-deletion";
import { notifyUser } from "@/lib/push";
import { RULES, rateHit, rateKey, rateReset, tooManyRequests } from "@/lib/rate-limit";
import { BodyTooLargeError, clientIp, readJsonLimited } from "@/lib/http";
import { claimRegistrationOtp, issueRegistrationOtp, registrationOtpEnabled, type OtpClaim } from "@/lib/registration-otp";
import { checkSecondFactor } from "@/lib/admin-2fa";
import { verifyReferralSignature } from "@/lib/referral-signature";
import { MAX_PASSWORD, MIN_NEW_PASSWORD } from "@/lib/password-policy";
import { accountFlags } from "@/lib/account-flags";
import { recordReferralSignup, referralLookupAllowed, referralLookupFailed } from "@/lib/referral-guard";

export const dynamic = "force-dynamic";

const USER_FIELDS = "id, role, name, phone, city, license, license_verification_status, specs, tier, debt_limit, debt_balance, cashback_balance, my_ref_code, is_active, created_at";

const NO_STORE = { "Cache-Control": "no-store" };
/** Same answer for an unknown account and a wrong password, so the form cannot be used to find registered numbers. */
const BAD_CREDENTIALS = "بيانات الدخول غير صحيحة. تحقق من الرقم وكلمة المرور.";

/** Accept Syrian phone numbers in local (09...) and international (+9639...) form. */
function phoneLookupCandidates(value: string): string[] {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  let local = digits;
  if (digits.startsWith("00963")) local = `0${digits.slice(5)}`;
  else if (digits.startsWith("963")) local = `0${digits.slice(3)}`;
  else if (digits.startsWith("9") && digits.length === 9) local = `0${digits}`;

  if (!/^09\d{8}$/.test(local)) return [...new Set([trimmed, digits])];
  return [...new Set([local, `+963${local.slice(1)}`, `963${local.slice(1)}`, `00963${local.slice(1)}`, digits, trimmed])];
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function serverError(context: string, err: unknown, message = "حدث خطأ غير متوقع في الخادم") {
  console.error(`[api/auth] ${context}:`, err);
  return json({ error: message }, 500);
}

/** A password check against a throw-away hash, so an unknown phone number costs the same time as a wrong password. */
let decoyHash: string | null = null;
function burnPasswordCheck(password: string) {
  decoyHash ??= hashPassword("euro-decoy-password");
  verifyPassword(decoyHash, password);
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      await clearSession();
      return json({ user: null });
    }

    const { data: user, error } = await getSupabaseAdmin()
      .from("users")
      .select(USER_FIELDS)
      .eq("id", session.id)
      .single();

    if (error || !user || !user.is_active) {
      await clearSession();
      return json({ user: null });
    }

    if (user.role === "worker") {
      return json({ user: { id: user.id, role: user.role, name: user.name, phone: user.phone, is_active: user.is_active, created_at: user.created_at } });
    }
    const { data: identities, error: identityError } = await getSupabaseAdmin()
      .from("user_auth_identities")
      .select("provider, email, email_verified")
      .eq("user_id", user.id);
    if (identityError) {
      console.error("[api/auth] identity metadata:", identityError);
    }
    const primaryIdentity = identities?.find((item) => item.email) ?? identities?.[0] ?? null;
    // Facts the app needs to pick its buttons (add or change the phone, add or change the password, referral link).
    // A separate best-effort query: if it fails the flags are left out and the app falls back to its defaults;
    // the sign-in answer above must never fail because of it. The password hash itself is never returned.
    let flags: Record<string, boolean> = {};
    const { data: flagRow, error: flagError } = await getSupabaseAdmin()
      .from("users").select("phone, password_hash, phone_verification_required").eq("id", user.id).maybeSingle();
    if (flagError) console.error("[api/auth] account flags:", flagError);
    else if (flagRow) flags = accountFlags(flagRow);
    return json({
      user: {
        ...user,
        ...flags,
        auth_email: primaryIdentity?.email ?? null,
        auth_provider: primaryIdentity?.provider ?? null,
      },
    });
  } catch (err) {
    console.error("[api/auth] GET:", err);
    // A database outage must not look like "signed out" (the app would drop the session).
    if (err instanceof SessionStoreError) return json({ error: "الخدمة غير متاحة مؤقتاً" }, 503);
    return json({ user: null });
  }
}

export async function POST(req: Request) {
  // An SMS code that was accepted but not used up (the sign-up then failed) is given back in `finally`.
  let otpClaim: OtpClaim | null = null;
  let otpSpent = false;
  try {
    const ip = clientIp(req);
    let body: Record<string, unknown>;
    try {
      const parsed = await readJsonLimited(req);
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch (error) {
      if (error instanceof BodyTooLargeError) return json({ error: "حجم الطلب كبير جداً" }, 413);
      return json({ error: "بيانات الطلب غير صالحة" }, 400);
    }
    const { mode = "login", role: requestedRole, name, phone, password, license, manualVerification, city, spec, refCode, refSignature, client, otpCode, otpToken } = body;
    let role = requestedRole as string | undefined;
    const isMobileClient = client === "mobile";

    const allowedRoles = mode === "login" ? (isMobileClient ? ["workshop", "marketer"] : ["workshop", "marketer", "admin", "worker"]) : ["workshop", "marketer"];

    if (mode === "send-otp") {
      // Registration without phone proof stays on until REGISTRATION_OTP_ENABLED=true is set on the server.
      if (!registrationOtpEnabled()) return json({ ok: true, otpRequired: false });
      if (!phone || String(phone).trim().length < 8) {
        return json({ error: "يرجى إدخال رقم موبايل صالح" }, 400);
      }
      const issued = await issueRegistrationOtp(String(phone).trim(), ip);
      if (!issued.ok) {
        if (issued.reason === "throttled") return tooManyRequests(issued.retryAfter ?? 60);
        if (issued.reason === "unavailable" || issued.reason === "unconfigured") return json({ error: "خدمة التحقق غير متاحة حالياً، حاول لاحقاً" }, 503);
        return json({ error: "تعذر إرسال الرسالة النصية، تأكد من صحة الرقم وحاول مجدداً" }, 502);
      }
      return json({ ok: true, otpToken: issued.token, message: "تم إرسال رمز التحقق برسالة نصية بنجاح" });
    }

    const roleIsValid = mode === "login" && isMobileClient && !role
      ? true
      : typeof role === "string" && allowedRoles.includes(role);
    if (!["login", "register"].includes(String(mode)) || !roleIsValid) {
      return json({ error: "نوع العملية أو الحساب غير صالح" }, 400);
    }
    const identifier = role === "worker" ? body.identifier : phone;
    if (typeof identifier !== "string" || !identifier.trim() || typeof password !== "string" || !password || password.length > MAX_PASSWORD) {
      return json({ error: role === "worker" ? "يرجى إدخال معرّف الموظف وكلمة المرور" : "يرجى إدخال رقم الموبايل وكلمة المرور" }, 400);
    }

    const db = getSupabaseAdmin();
    const cleanPhone = identifier.trim();
    if (cleanPhone.length > 32) return json({ error: "رقم الموبايل غير صالح" }, 400);
    if (role === "worker" && !/^[0-9]{8,10}$/.test(cleanPhone)) {
      return json({ error: "معرّف الموظف يجب أن يتكون من 8 إلى 10 أرقام" }, 400);
    }

    // ------------------------------------------------------------------------------------------ sign in
    if (mode === "login") {
      // Brute-force protection: failed attempts per account and per address; success clears the account counter.
      // If the counter store fails the limiter keeps counting in memory (lib/rate-limit.ts): it never switches off.
      const phoneCandidates = role === "worker" ? [cleanPhone] : phoneLookupCandidates(cleanPhone);
      const accountKey = rateKey("login-account", role ?? "any", phoneCandidates[0]);
      const addressKey = rateKey("login-ip", ip);
      const blocked = await rateHit(accountKey, RULES.loginFailPerAccount, { increment: false });
      if (!blocked.allowed) return tooManyRequests(blocked.retryAfter);
      const addressBlocked = await rateHit(addressKey, RULES.loginPerIp, { increment: false });
      if (!addressBlocked.allowed) return tooManyRequests(addressBlocked.retryAfter);

      const failed = async () => {
        const [account, address] = await Promise.all([
          rateHit(accountKey, RULES.loginFailPerAccount),
          rateHit(addressKey, RULES.loginPerIp),
        ]);
        const worst = !account.allowed ? account : address;
        if (!account.allowed || !address.allowed) return tooManyRequests(worst.retryAfter);
        return json({ error: BAD_CREDENTIALS }, 401);
      };

      let userLookup = db.from("users").select(`${USER_FIELDS}, password_hash`).in("phone", phoneCandidates);
      if (role) userLookup = userLookup.eq("role", role);
      else userLookup = userLookup.in("role", ["workshop", "marketer"]);
      const { data: matchedUsers, error: findError } = await userLookup.limit(2);
      if (findError) return serverError("lookup", findError, "خطأ في الاتصال بقاعدة البيانات");

      const candidates = (matchedUsers ?? []).filter((user) => user.password_hash);
      const verified = candidates.filter((user) => verifyPassword(String(user.password_hash), password));
      if (!candidates.length) burnPasswordCheck(password);
      if (!verified.length) return failed();
      if (verified.length > 1) {
        return json({ error: "يوجد أكثر من حساب مرتبط بهذا الرقم. تواصل مع الإدارة لتحديد الحساب." }, 409);
      }
      const existingUser = verified[0];

      if (!existingUser.is_active) {
        return json({
          pendingApproval: true,
          error: "حسابك قيد المراجعة من قِبل الإدارة، وسيتم تفعيله بعد التحقق من البيانات.",
        }, 403);
      }

      // Administrators who enrolled in two-step verification must also send an app code or a recovery code.
      const second = await checkSecondFactor(String(existingUser.id), existingUser.role, {
        totpCode: body.totpCode, recoveryCode: body.recoveryCode,
      });
      if (second.status === "limited") return tooManyRequests(second.retryAfter);
      if (second.status === "required") {
        return json({ twoFactorRequired: true, error: "أدخل رمز التحقق بخطوتين من تطبيق المصادقة." }, 401);
      }
      if (second.status === "invalid") return json({ twoFactorRequired: true, error: "رمز التحقق غير صحيح." }, 401);

      if (isLegacyPasswordHash(String(existingUser.password_hash ?? ""))) {
        const upgradedHash = hashPassword(password);
        const { error: rehashError } = await db.from("users").update({ password_hash: upgradedHash })
          .eq("id", existingUser.id).eq("password_hash", existingUser.password_hash);
        if (rehashError) console.error("[api/auth] legacy password rehash:", rehashError);
      }

      // The 30 days of an account-deletion request are over: finish it and refuse the sign-in (never throws).
      if (await finalizeDueDeletion(String(existingUser.id))) {
        return json({ error: BAD_CREDENTIALS }, 401);
      }

      await rateReset(accountKey);
      const accessToken = await setSession({
        id: String(existingUser.id),
        role: existingUser.role,
        name: existingUser.name,
        phone: existingUser.phone,
        my_ref_code: existingUser.my_ref_code,
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password_hash: _omit, ...publicUser } = existingUser;
      const safeUser = existingUser.role === "worker"
        ? { id: existingUser.id, role: existingUser.role, name: existingUser.name, phone: existingUser.phone, is_active: existingUser.is_active, created_at: existingUser.created_at }
        : publicUser;
      return json({ ok: true, user: safeUser, ...(isMobileClient ? { accessToken } : {}) });
    }

    // ------------------------------------------------------------------------------------------ sign up
    const limited = await rateHit(rateKey("register-ip", ip), RULES.registerPerIp);
    if (!limited.allowed) return tooManyRequests(limited.retryAfter);

    if (password.length < MIN_NEW_PASSWORD) {
      return json({ error: `كلمة المرور يجب أن تكون ${MIN_NEW_PASSWORD} أحرف على الأقل` }, 400);
    }

    if (registrationOtpEnabled()) {
      if (!otpCode || !otpToken) {
        return json({ error: "يرجى إدخال رمز التحقق المرسل برسالة نصية" }, 400);
      }
      const otpLimited = await rateHit(rateKey("otp-verify-ip", ip), RULES.otpVerifyPerIp);
      if (!otpLimited.allowed) return tooManyRequests(otpLimited.retryAfter);
      otpClaim = await claimRegistrationOtp(cleanPhone, otpCode, otpToken);
      if (!otpClaim.ok) {
        return otpClaim.reason === "failed"
          ? json({ error: "تعذر التحقق من الرمز حالياً، حاول لاحقاً" }, 503)
          : json({ error: "رمز التحقق غير صحيح أو انتهت صلاحيته، أعد طلب رمز جديد" }, 400);
      }
    }

    const { data: alreadyThere, error: existsError } = await db.from("users").select("id")
      .eq("phone", cleanPhone).eq("role", role as string).limit(1);
    if (existsError) return serverError("register lookup", existsError, "خطأ في الاتصال بقاعدة البيانات");
    if (alreadyThere?.length) return json({ error: "هذا الرقم مسجل مسبقاً بنفس نوع الحساب." }, 400);
    if (!name || !String(name).trim()) return json({ error: "الاسم مطلوب لإنشاء الحساب" }, 400);
    if (role === "workshop" && ((!String(license ?? "").trim() && manualVerification !== true) || !city || !spec)) {
      return json({ error: "يرجى إدخال رقم الترخيص، أو اختيار التحقق اليدوي والتأكد من إدخال المدينة والاختصاص" }, 400);
    }

    const specsArray = spec
      ? String(spec).split(/[,،]/).map((s: string) => s.trim()).filter(Boolean)
      : [];

    let validatedReferralCode: string | null = null;
    if (role === "workshop" && typeof refCode === "string" && refCode.trim()) {
      const candidateCode = refCode.trim().slice(0, 80);
      const lookup = await referralLookupAllowed(ip);
      if (!lookup.allowed) return tooManyRequests(lookup.retryAfter);
      if (typeof refSignature === "string" && refSignature.trim() && !verifyReferralSignature(candidateCode, refSignature.trim())) {
        await referralLookupFailed(ip);
        return json({ error: "كود الإحالة مثبت من رابط المسوّق ولا يمكن تغييره" }, 400);
      }
      const { data: referrer, error: referralError } = await db.from("users")
        .select("id").eq("role", "marketer").eq("my_ref_code", candidateCode).eq("is_active", true).maybeSingle();
      if (referralError) return serverError("referral lookup", referralError, "تعذر التحقق من كود الإحالة");
      if (!referrer) {
        await referralLookupFailed(ip);
        return json({ error: "كود الإحالة غير صحيح أو حساب المسوّق غير مفعّل" }, 400);
      }
      validatedReferralCode = candidateCode;
    } else if (role === "workshop" && typeof refSignature === "string" && refSignature.trim()) {
      return json({ error: "رابط الإحالة غير مكتمل؛ افتح رابط المسوّق من جديد" }, 400);
    }

    // The slow PBKDF2 hash is only computed for a request that passed every cheaper check above.
    const passHash = hashPassword(password);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let newUser: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let insertError: any = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const generatedRefCode = role === "marketer"
        ? `MK-${crypto.randomBytes(3).toString("hex").toUpperCase()}`
        : null;

      const result = await db.from("users").insert({
        role,
        name: String(name).trim(),
        phone: cleanPhone,
        password_hash: passHash,
        license: role === "workshop" ? (String(license ?? "").trim() || null) : null,
        license_verification_status: role === "workshop" && !String(license ?? "").trim() ? "pending" : null,
        city: city ? String(city).trim() : null,
        specs: specsArray,
        my_ref_code: generatedRefCode,
        referred_by_code: validatedReferralCode,
        tier: role === "workshop" ? "Standard" : undefined,
        is_active: role !== "workshop",
      }).select(USER_FIELDS).single();

      if (!result.error) {
        newUser = result.data;
        insertError = null;
        break;
      }
      insertError = result.error;
      if (!(result.error.code === "23505" && result.error.message?.includes("my_ref_code"))) break;
    }

    if (insertError || !newUser) {
      if (insertError?.code === "23505") return json({ error: "هذا الرقم مسجل مسبقاً أو تعذر إنشاء كود فريد." }, 400);
      return serverError("register", insertError, "تعذر إنشاء الحساب");
    }
    otpSpent = true;

    if (validatedReferralCode) {
      await recordReferralSignup({ newUserId: String(newUser.id), newUserPhone: cleanPhone, referralCode: validatedReferralCode, ip });
      const { data: referrer } = await db.from("users").select("id")
        .eq("role", "marketer").eq("my_ref_code", validatedReferralCode).maybeSingle();
      if (referrer) {
        await notifyUser({
          userId: String(referrer.id),
          type: "referral_new",
          title: "إحالة جديدة",
          body: "انضم مستخدم جديد عبر رابطك",
          eventKey: `referral:user:${newUser.id}`,
          data: { screen: "dashboard", referralUserId: String(newUser.id) },
        });
      }
    }

    if (role === "workshop") {
      return json({
        ok: true,
        pendingApproval: true,
        message: "تم إرسال طلب تسجيل الورشة للإدارة. سيتم تفعيل الحساب بعد مراجعة البيانات.",
      });
    }

    const accessToken = await setSession({
      id: String(newUser.id),
      role: newUser.role,
      name: newUser.name,
      phone: newUser.phone,
      my_ref_code: newUser.my_ref_code,
    });
    return json({ ok: true, user: newUser, ...(isMobileClient ? { accessToken } : {}) });
  } catch (err) {
    return serverError("POST", err);
  } finally {
    if (otpClaim?.ok && !otpSpent) await otpClaim.release();
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      await clearSession();
      return json({ error: "الجلسة غير صالحة، سجّل الدخول مجدداً" }, 401);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await readJsonLimited(req);
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return json({ error: "بيانات الطلب غير صالحة" }, 400);
    }

    const db = getSupabaseAdmin();
    const updates: Record<string, string> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (name.length < 2 || name.length > 100) return json({ error: "الاسم يجب أن يكون بين حرفين و100 حرف" }, 400);
      updates.name = name;
    }
    if (typeof body.city === "string") {
      const city = body.city.trim();
      if (city.length > 80) return json({ error: "اسم المحافظة طويل جداً" }, 400);
      if (city) updates.city = city;
    }
    const changingPassword = typeof body.newPassword === "string" && body.newPassword.length > 0;
    if (changingPassword) {
      const newPassword = body.newPassword as string;
      if (newPassword.length < MIN_NEW_PASSWORD || newPassword.length > MAX_PASSWORD) {
        return json({ error: `كلمة المرور الجديدة يجب أن تكون بين ${MIN_NEW_PASSWORD} و${MAX_PASSWORD} حرفاً` }, 400);
      }
      // Changing a password needs the current one (an account created through Firebase has none to ask for).
      const { data: current, error: currentError } = await db.from("users").select("password_hash").eq("id", session.id).maybeSingle();
      if (currentError || !current) return serverError("password lookup", currentError, "تعذر التحقق من الحساب");
      if (current.password_hash) {
        const key = rateKey("password-change", session.id);
        const blocked = await rateHit(key, RULES.loginFailPerAccount, { increment: false });
        if (!blocked.allowed) return tooManyRequests(blocked.retryAfter);
        const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
        if (!currentPassword) return json({ error: "أدخل كلمة المرور الحالية" }, 400);
        if (!verifyPassword(String(current.password_hash), currentPassword)) {
          const after = await rateHit(key, RULES.loginFailPerAccount);
          return after.allowed ? json({ error: "كلمة المرور الحالية غير صحيحة" }, 403) : tooManyRequests(after.retryAfter);
        }
        await rateReset(key);
      }
      updates.password_hash = hashPassword(newPassword);
    }
    if (!Object.keys(updates).length) return json({ error: "لا توجد تغييرات صالحة للحفظ" }, 400);

    const { data: user, error } = await db.from("users")
      .update(updates)
      .eq("id", session.id)
      .eq("is_active", true)
      .select(USER_FIELDS)
      .single();
    if (error || !user) return serverError("update", error, "تعذر تحديث البيانات");

    if (changingPassword) {
      // Every token issued before this moment (other devices, a thief's copy) stops working; this device gets a new one.
      try {
        await bumpTokenVersion(String(user.id));
      } catch (err) {
        console.error("[api/auth] revoke sessions after password change:", err);
      }
      await notifyUser({
        userId: String(user.id),
        type: "security_password_changed",
        title: "تغيير كلمة المرور",
        body: "تم تغيير كلمة المرور بنجاح",
        eventKey: `security:password-changed:${user.id}:${Date.now()}`,
        data: { screen: "account", security: "password_changed" },
      });
    }

    const accessToken = await setSession({
      id: String(user.id),
      role: user.role,
      name: user.name ?? "",
      phone: user.phone ?? "",
      my_ref_code: user.my_ref_code,
    });
    return json({ ok: true, user, ...(changingPassword ? { accessToken } : {}) });
  } catch (err) {
    return serverError("PUT", err, "حدث خطأ أثناء تحديث البيانات");
  }
}

export async function DELETE() {
  await clearSession();
  return json({ ok: true });
}
