"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";

export default function AdminLogin() {
  const [role, setRole] = useState<"admin" | "worker">("admin");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "login", role, ...(role === "worker" ? { identifier: phone.trim() } : { phone: phone.trim() }), password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "تعذر تسجيل الدخول");
        return;
      }
      window.location.href = role === "worker" ? "/admin/orders" : "/admin";
    } catch {
      setError("تعذر الاتصال بالخادم. حاول مجدداً.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-canvas grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="text-center">
          <ShieldCheck className="mx-auto mb-2 text-[#0A84FF]" size={36} />
          <h1 className="text-xl font-semibold tracking-tight text-white">{role === "worker" ? "دخول الموظفين" : "دخول الإدارة"}</h1>
          <p className="mt-1 text-sm text-white/65">لوحة تحكم اليورو</p>
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-black/20 p-1">
            <button type="button" onClick={() => setRole("admin")} className={`rounded-lg px-3 py-2 text-sm ${role === "admin" ? "bg-white/15 text-white" : "text-white/55"}`}>مدير</button>
            <button type="button" onClick={() => setRole("worker")} className={`rounded-lg px-3 py-2 text-sm ${role === "worker" ? "bg-white/15 text-white" : "text-white/55"}`}>موظف</button>
          </div>
        </div>
        <input className="inp" dir="ltr" autoComplete="username" inputMode={role === "worker" ? "numeric" : "tel"} maxLength={role === "worker" ? 10 : 20} placeholder={role === "worker" ? "معرّف الموظف (8–10 أرقام)" : "رقم الموبايل"} value={phone} onChange={(e) => setPhone(e.target.value)} required />
        <input className="inp" type="password" autoComplete="current-password" placeholder="كلمة المرور" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p role="alert" className="rounded-2xl border border-[#FF453A]/40 bg-[#FF453A]/15 p-3 text-sm text-[#FF6961]">{error}</p>}
        <button type="submit" disabled={loading} className="btn w-full">{loading ? "جارٍ التحقق..." : "دخول"}</button>
      </form>
    </main>
  );
}
