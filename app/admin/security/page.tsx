"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api, ErrorBox, PageHead, Spinner, toast, useApi } from "@/components/admin/kit";

type Status = { enrolled: boolean; available: boolean; emergencyBypass: boolean };

export default function SecurityPage() {
  const { data, error, loading, reload } = useApi<Status>("/api/admin/2fa");
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const r = await api<Record<string, unknown>>("/api/admin/2fa", { method: "POST", body });
    setBusy(false);
    if (!r.ok) {
      toast(r.error, "err");
      return null;
    }
    return r.data;
  }

  async function begin() {
    const r = await act({ action: "begin" });
    if (r) setSetup({ secret: String(r.secret), otpauthUri: String(r.otpauthUri) });
  }
  async function confirm() {
    const r = await act({ action: "confirm", code });
    if (r) {
      setRecovery(r.recoveryCodes as string[]);
      setSetup(null);
      setCode("");
      reload();
    }
  }
  async function disable() {
    const r = await act({ action: "disable", password, code });
    if (r) {
      toast("تم إيقاف التحقق بخطوتين");
      setPassword("");
      setCode("");
      reload();
    }
  }

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error || "تعذر التحميل"} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <PageHead title="الأمان" sub="التحقق بخطوتين لحساب المدير" />
      <section className="card space-y-3">
        <div className="flex items-center gap-2 text-white"><ShieldCheck size={20} /><h2 className="font-semibold">تطبيق المصادقة (TOTP)</h2></div>
        {!data.available && <p className="text-sm text-[#FFD60A]">الميزة غير مفعّلة بعد على الخادم: يلزم تطبيق ترحيل قاعدة البيانات الخاص بها.</p>}
        {data.emergencyBypass && <p className="text-sm text-[#FF6961]">تنبيه: مفتاح الطوارئ ADMIN_2FA_DISABLED مفعّل على الخادم، والتحقق بخطوتين متجاوز حالياً. احذفه من Render.</p>}
        {data.available && !data.enrolled && !setup && (
          <>
            <p className="text-sm text-white/70">عند التفعيل سيُطلب رمز من التطبيق مع كل تسجيل دخول للإدارة. لن يتغير شيء قبل إتمام الإعداد.</p>
            <button className="btn" disabled={busy} onClick={begin}>بدء الإعداد</button>
          </>
        )}
        {setup && (
          <div className="space-y-3">
            <p className="text-sm text-white/70">أضف الحساب في تطبيق المصادقة (مثل Google Authenticator) عبر المفتاح التالي، ثم اكتب الرمز المكوّن من 6 أرقام:</p>
            <code dir="ltr" className="block select-all break-all rounded-xl bg-black/30 p-3 text-sm text-white">{setup.secret}</code>
            <a className="text-sm text-[#0A84FF]" href={setup.otpauthUri}>فتح في تطبيق المصادقة</a>
            <input className="inp" dir="ltr" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn" disabled={busy || code.length !== 6} onClick={confirm}>تأكيد وتفعيل</button>
          </div>
        )}
        {recovery && (
          <div className="space-y-2 rounded-xl border border-[#FFD60A]/40 bg-[#FFD60A]/10 p-3">
            <p className="text-sm text-white">رموز الاسترداد (تظهر مرة واحدة فقط؛ كل رمز يُستخدم مرة واحدة). احفظها في مكان آمن:</p>
            <ul dir="ltr" className="grid grid-cols-2 gap-1 font-mono text-sm text-white">{recovery.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
        {data.enrolled && (
          <div className="space-y-3">
            <p className="text-sm text-[#30D158]">التحقق بخطوتين مفعّل.</p>
            <p className="text-sm text-white/70">لإيقافه أدخل كلمة المرور ورمز التطبيق (أو رمز استرداد):</p>
            <input className="inp" type="password" autoComplete="current-password" placeholder="كلمة المرور" value={password} onChange={(e) => setPassword(e.target.value)} />
            <input className="inp" dir="ltr" placeholder="رمز التطبيق أو رمز الاسترداد" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn2" disabled={busy || !password || !code} onClick={disable}>إيقاف التحقق بخطوتين</button>
          </div>
        )}
      </section>
    </div>
  );
}
