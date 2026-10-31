import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  COOKIE_NAME,
  clearSession,
  getSession,
  hashPassword,
  safeEqual,
  setSession,
  verifySession,
  signSession,
} from "@/lib/session";
import { cookies } from "next/headers";
import { finalizeDueDeletion } from "@/lib/account-deletion";

export const dynamic = "force-dynamic";

const USER_FIELDS = "id, role, name, phone, city, license, specs, tier, debt_limit, debt_balance, cashback_balance, my_ref_code, is_active, created_at";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function serverError(context: string, err: unknown, message = "حدث خطأ غير متوقع في الخادم") {
  console.error(`[api/auth] ${context}:`, err);
  return json({ error: message }, 500);
}

async function sendWhatsAppOtp(phone: string, code: string) {
  const apiUrl = process.env.GREEN_API_URL;
  const instanceId = process.env.GREEN_API_INSTANCE_ID;
  const token = process.env.GREEN_API_TOKEN;

  if (!apiUrl || !instanceId || !token) {
    console.error("[Green-API] Missing environment variables");
    return false;
  }

  const url = `${apiUrl}/waInstance${instanceId}/sendMessage/${token}`;
  const chatId = `${phone}@c.us`;
  const message = `رمز التحقق الخاص بك في تطبيق EURO CARS هو: *${code}*.\nصالح لمدة 5 دقائق.`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, message }),
    });
    const data = await res.json();
    return res.ok && Boolean(data.idMessage);
  } catch (err) {
    console.error("[Green-API] Error sending message:", err);
    return false;
  }
}

export async function GET() {
  try {
    const token = cookies().get(COOKIE_NAME)?.value;
    if (!token) return json({ user: null });

    const session = verifySession(token);
    if (!session) {
      clearSession();
      return json({ user: null });
    }

    const { data: user, error } = await getSupabaseAdmin()
      .from("users")
      .select(USER_FIELDS)
      .eq("id", session.id)
      .single();

    if (error || !user || !user.is_active) {
      clearSession();
      return json({ user: null });
    }

    return json({ user });
  } catch (err) {
    console.error("[api/auth] GET:", err);
    return json({ user: null });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { mode = "login", role, name, phone, password, license, city, spec, refCode, refSignature, client, otpCode, otpToken } = body ?? {};
    const isMobileClient = client === "mobile";

    const allowedRoles = mode === "login" ? (isMobileClient ? ["workshop", "marketer"] : ["workshop", "marketer", "admin"]) : ["workshop", "marketer"];

    if (mode === "send-otp") {
      if (!phone || String(phone).trim().length < 8) {
        return json({ error: "يرجى إدخال رقم موبايل صالح" }, 400);
      }
      const cleanPhone = String(phone).trim();
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = Date.now() + 5 * 60 * 1000;
      const secret = process.env.AUTH_SECRET || "euro-secret";
      const signature = crypto.createHmac("sha256", secret).update(`${cleanPhone}:${code}:${expires}`).digest("hex");
      const tokenPayload = Buffer.from(JSON.stringify({ p: cleanPhone, c: code, e: expires, s: signature })).toString("base64");

      const sent = await sendWhatsAppOtp(cleanPhone, code);
      if (!sent) {
        return json({ error: "تعذر إرسال رسالة الواتساب، تأكد من صحة الرقم أو ربط حساب الواتساب" }, 500);
      }
      return json({ ok: true, otpToken: tokenPayload, message: "تم إرسال رمز التحقق إلى واتساب بنجاح" });
    }

    if (!["login", "register"].includes(mode) || !allowedRoles.includes(role)) {
      return json({ error: "نوع العملية أو الحساب غير صالح" }, 400);
    }
    if (!phone || !password || String(password).length < 4) {
      return json({ error: "يرجى إدخال رقم الموبايل وكلمة مرور من 4 أحرف على الأقل" }, 400);
    }

    const db = getSupabaseAdmin();
    const cleanPhone = String(phone).trim();
    const passHash = hashPassword(String(password));
    const { data: existingUser, error: findError } = await db
      .from("users")
      .select(`${USER_FIELDS}, password_hash`)
      .eq("phone", cleanPhone)
      .eq("role", role)
      .maybeSingle();

    if (findError) return serverError("lookup", findError, "خطأ في الاتصال بقاعدة البيانات");

    if (mode === "login") {
      if (!existingUser) return json({ error: "لا يوجد حساب مسجل بهذا الرقم ونوع الحساب." }, 404);
      if (!safeEqual(String(existingUser.password_hash ?? ""), passHash)) {
        return json({ error: "كلمة المرور غير صحيحة" }, 401);
      }
      if (!existingUser.is_active) {
        return json({
          pendingApproval: true,
          error: "حسابك قيد المراجعة من قِبل الإدارة، وسيتم تفعيله بعد التحقق من البيانات.",
        }, 403);
      }

      // The 30 days of an account-deletion request are over: finish it and refuse the sign-in (never throws).
      if (await finalizeDueDeletion(String(existingUser.id))) {
        return json({ error: "لا يوجد حساب مسجل بهذا الرقم ونوع الحساب." }, 404);
      }

      setSession({
        id: String(existingUser.id),
        role: existingUser.role,
        name: existingUser.name,
        phone: existingUser.phone,
        my_ref_code: existingUser.my_ref_code,
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password_hash: _omit, ...publicUser } = existingUser;
      const accessToken = isMobileClient ? signSession({ id: String(existingUser.id), role: existingUser.role, name: existingUser.name, phone: existingUser.phone, my_ref_code: existingUser.my_ref_code, iat: Date.now() }) : undefined;
      return json({ ok: true, user: publicUser, ...(accessToken ? { accessToken } : {}) });
    }

    if (!otpCode || !otpToken) {
      return json({ error: "يرجى إدخال رمز التحقق المرسل إلى واتساب" }, 400);
    }
    try {
      const decoded = JSON.parse(Buffer.from(String(otpToken), "base64").toString("utf-8"));
      const secret = process.env.AUTH_SECRET || "euro-secret";
      const expectedSig = crypto.createHmac("sha256", secret).update(`${cleanPhone}:${decoded.c}:${decoded.e}`).digest("hex");
      if (!safeEqual(expectedSig, decoded.s) || decoded.p !== cleanPhone || Date.now() > decoded.e) {
        return json({ error: "رمز التحقق غير صحيح أو انتهت صلاحيته، أعد طلب رمز جديد" }, 400);
      }
      if (String(otpCode).trim() !== String(decoded.c)) {
        return json({ error: "رمز التحقق المدخل غير صحيح" }, 400);
      }
    } catch {
      return json({ error: "بيانات التحقق غير صالحة" }, 400);
    }

    if (existingUser) return json({ error: "هذا الرقم مسجل مسبقاً بنفس نوع الحساب." }, 400);
    if (!name || !String(name).trim()) return json({ error: "الاسم مطلوب لإنشاء الحساب" }, 400);
    if (role === "workshop" && (!license || !city || !spec)) {
      return json({ error: "يرجى إدخال رقم الترخيص والمدينة واختصاص الماركات للورشة" }, 400);
    }

    const specsArray = spec
      ? String(spec).split(/[,،]/).map((s: string) => s.trim()).filter(Boolean)
      : [];

    let validatedReferralCode: string | null = null;
    if (role === "workshop" && typeof refCode === "string" && refCode.trim()) {
      const candidateCode = refCode.trim().slice(0, 80);
      if (typeof refSignature === "string" && refSignature.trim()) {
        const expectedSignature = crypto.createHmac("sha256", process.env.AUTH_SECRET || "")
          .update(`workshop-referral:${candidateCode}`).digest("hex");
        if (!safeEqual(expectedSignature, refSignature.trim())) {
          return json({ error: "كود الإحالة مثبت من رابط المسوّق ولا يمكن تغييره" }, 400);
        }
      }
      const { data: referrer, error: referralError } = await db.from("users")
        .select("id").eq("role", "marketer").eq("my_ref_code", candidateCode).eq("is_active", true).maybeSingle();
      if (referralError) return serverError("referral lookup", referralError, "تعذر التحقق من كود الإحالة");
      if (!referrer) return json({ error: "كود الإحالة غير صحيح أو حساب المسوّق غير مفعّل" }, 400);
      validatedReferralCode = candidateCode;
    } else if (role === "workshop" && typeof refSignature === "string" && refSignature.trim()) {
      return json({ error: "رابط الإحالة غير مكتمل؛ افتح رابط المسوّق من جديد" }, 400);
    }

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
        license: role === "workshop" ? String(license).trim() : null,
        city: city ? String(city).trim() : null,
        specs: specsArray,
        my_ref_code: generatedRefCode,
        referred_by_code: validatedReferralCode,
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

    if (role === "workshop") {
      return json({
        ok: true,
        pendingApproval: true,
        message: "تم إرسال طلب تسجيل الورشة للإدارة. سيتم تفعيل الحساب بعد مراجعة البيانات.",
      });
    }

    setSession({
      id: String(newUser.id),
      role: newUser.role,
      name: newUser.name,
      phone: newUser.phone,
      my_ref_code: newUser.my_ref_code,
    });
    const accessToken = isMobileClient ? signSession({ id: String(newUser.id), role: newUser.role, name: newUser.name, phone: newUser.phone, my_ref_code: newUser.my_ref_code, iat: Date.now() }) : undefined;
    return json({ ok: true, user: newUser, ...(accessToken ? { accessToken } : {}) });
  } catch (err) {
    return serverError("POST", err);
  }
}

export async function PUT(req: Request) {
  try {
    const token = cookies().get(COOKIE_NAME)?.value;
    if (!token) return json({ error: "يرجى تسجيل الدخول أولاً" }, 401);
    const session = getSession();
    if (!session) {
      clearSession();
      return json({ error: "الجلسة غير صالحة، سجّل الدخول مجدداً" }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "بيانات الطلب غير صالحة" }, 400);
    }

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
    if (typeof body.newPassword === "string" && body.newPassword.length) {
      if (body.newPassword.length < 4 || body.newPassword.length > 128) {
        return json({ error: "كلمة المرور الجديدة يجب أن تكون بين 4 و128 حرفاً" }, 400);
      }
      updates.password_hash = hashPassword(body.newPassword);
    }
    if (!Object.keys(updates).length) return json({ error: "لا توجد تغييرات صالحة للحفظ" }, 400);

    const { data: user, error } = await getSupabaseAdmin().from("users")
      .update(updates)
      .eq("id", session.id)
      .eq("is_active", true)
      .select(USER_FIELDS)
      .single();
    if (error || !user) return serverError("update", error, "تعذر تحديث البيانات");

    setSession({
      id: String(user.id),
      role: user.role,
      name: user.name,
      phone: user.phone,
      my_ref_code: user.my_ref_code,
    });
    return json({ ok: true, user });
  } catch (err) {
    return serverError("PUT", err, "حدث خطأ أثناء تحديث البيانات");
  }
}

export async function DELETE() {
  clearSession();
  return json({ ok: true });
}
