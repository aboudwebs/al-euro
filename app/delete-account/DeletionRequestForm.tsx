"use client";

import { useState, type FormEvent } from "react";

type Role = "workshop" | "marketer";
type RequestInfo = { id: string; requestedAt: string; dueAt: string; graceDays: number };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-SY", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}

export default function DeletionRequestForm() {
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("workshop");
  const [otpToken, setOtpToken] = useState("");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [request, setRequest] = useState<RequestInfo | null>(null);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/public/account-deletion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send-code", phone: phone.trim(), role }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر إرسال رمز التحقق.");
      setOtpToken(data.otpToken || "");
      setChannel(data.channel === "email" ? "email" : "sms");
      setSent(true);
      setNotice(data.message || "إذا كان الرقم مرتبطاً بحساب، سيصلك رمز التحقق.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally { setBusy(false); }
  }

  async function confirmCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/public/account-deletion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm-code", phone: phone.trim(), role, channel, otpCode: code.trim(), otpToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر تسجيل طلب الحذف.");
      setRequest(data.request);
      setNotice(data.message || "تم تسجيل طلب حذف الحساب.");
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-xl sm:p-7">
      {request ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-4 text-emerald-100">
            <p className="font-bold">تم تسجيل طلب حذف الحساب</p>
            <p className="mt-2 text-sm leading-7">تبقى بياناتك الشخصية خلال مهلة الاسترجاع، ثم تُزال أو تُخفى بعد انتهائها. يمكنك إلغاء الطلب من داخل التطبيق ما دام تنفيذه لم يكتمل.</p>
          </div>
          <dl className="grid gap-3 rounded-xl bg-black/20 p-4 text-sm sm:grid-cols-2">
            <div><dt className="text-white/55">تاريخ الطلب</dt><dd className="mt-1 font-semibold">{formatDate(request.requestedAt)}</dd></div>
            <div><dt className="text-white/55">موعد تنفيذ الحذف</dt><dd className="mt-1 font-semibold">{formatDate(request.dueAt)}</dd></div>
          </dl>
        </div>
      ) : !sent ? (
        <form onSubmit={sendCode} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              نوع الحساب
              <select value={role} onChange={e => setRole(e.target.value as Role)} className="mt-2 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-white outline-none focus:border-emerald-400">
                <option value="workshop">ورشة</option>
                <option value="marketer">مسوّق</option>
              </select>
            </label>
            <label className="block text-sm font-semibold">
              رقم الهاتف المسجّل بالحساب
              <input value={phone} onChange={e => setPhone(e.target.value)} required inputMode="tel" autoComplete="tel" placeholder="09xxxxxxxx أو 9639xxxxxxxx" className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-left text-base outline-none focus:border-emerald-400" dir="ltr" />
            </label>
          </div>
          <button disabled={busy} className="w-full rounded-xl bg-emerald-500 px-4 py-3 font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50">
            {busy ? "جارٍ الإرسال…" : "إرسال رمز التحقق"}
          </button>
          <p className="text-xs leading-6 text-white/50">نرسل رمزاً عبر SMS، أو إلى البريد الإلكتروني الموثّق المرتبط بالحساب إذا تعذّر إرسال الرسالة النصية.</p>
        </form>
      ) : (
        <form onSubmit={confirmCode} className="space-y-4">
          <label className="block text-sm font-semibold">
            رمز التحقق
              <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-center text-xl tracking-[0.35em] outline-none focus:border-emerald-400" dir="ltr" />
            </label>
          </div>
          <p className="text-xs leading-6 text-white/50">أدخل الرمز الذي وصلك عبر وسيلة التحقق الموضحة أعلاه.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button disabled={busy} className="flex-1 rounded-xl bg-emerald-500 px-4 py-3 font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
              {busy ? "جارٍ التحقق…" : "تأكيد وتسجيل طلب الحذف"}
            </button>
            <button type="button" disabled={busy} onClick={() => { setSent(false); setOtpToken(""); setCode(""); setNotice(""); setError(""); }} className="rounded-xl border border-white/15 px-4 py-3 text-white/75 hover:bg-white/5 disabled:opacity-50">
              تغيير الرقم
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">{notice}</p>}
    </div>
  );
}
