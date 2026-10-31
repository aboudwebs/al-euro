"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";

export default function AdminPasswordReset() {
  const [phone, setPhone] = useState("0951708141");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setSuccess("");
    if (password !== confirm) {
      setError("كلمتا المرور غير متطابقتين.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ phone: phone.trim(), token, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "تعذر تغيير كلمة المرور.");
        return;
      }
      setSuccess(data.message || "تم تغيير كلمة المرور.");
      setToken("");
      setPassword("");
      setConfirm("");
    } catch {
      setError("تعذر الاتصال بالخادم. حاول مجدداً.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-canvas grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="card w-full max-w-md space-y-4 p-6">
        <div className="text-center">
          <KeyRound className="mx-auto mb-2 text-[#0A84FF]" size={36} />
          <h1 className="text-xl font-semibold tracking-tight">إعادة تعيين كلمة مرور المدير</h1>
          <p className="mt-2 text-sm opacity-70">هذه الصفحة تحتاج رمز إعادة التعيين الذي تضبطه في Render.</p>
        </div>
        <label className="block space-y-1 text-sm">
          <span>رقم المدير</span>
          <input className="inp" dir="ltr" inputMode="tel" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </label>
        <label className="block space-y-1 text-sm">
          <span>رمز إعادة التعيين</span>
          <input className="inp" dir="ltr" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <label className="block space-y-1 text-sm">
          <span>كلمة المرور الجديدة (8 أحرف على الأقل)</span>
          <input className="inp" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label className="block space-y-1 text-sm">
          <span>تأكيد كلمة المرور</span>
          <input className="inp" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {error && <p role="alert" className="rounded-2xl border border-[#FF453A]/40 bg-[#FF453A]/15 p-3 text-sm text-[#FF6961]">{error}</p>}
        {success && <p role="status" className="rounded-2xl border border-[#30D158]/40 bg-[#30D158]/10 p-3 text-sm text-[#30D158]">{success}</p>}
        <button type="submit" disabled={loading} className="btn w-full">{loading ? "جارٍ تغيير كلمة المرور..." : "تغيير كلمة المرور"}</button>
        <a className="block text-center text-sm text-[#0A84FF]" href="/admin/login"><ShieldCheck className="mr-1 inline" size={16} /> العودة لتسجيل الدخول</a>
      </form>
    </main>
  );
}
