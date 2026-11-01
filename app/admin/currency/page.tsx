"use client";
import { useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { api, ErrorBox, PageHead, Spinner, toast, useApi } from "@/components/admin/kit";

type CurrencyData = { usdToSyp: number | null; updatedAt: string | null };

export default function CurrencySettingsPage() {
  const { data, error, loading, reload } = useApi<CurrencyData>("/api/admin/currency");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const current = data?.usdToSyp;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const value = Number(rate || current || 0);
    if (!Number.isFinite(value) || value < 1 || value > 1_000_000_000) return toast("أدخل سعر صرف صحيحاً", "err");
    setBusy(true);
    const r = await api<CurrencyData>("/api/admin/currency", { method: "PUT", body: { usdToSyp: value } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "err");
    setRate(String(r.data?.usdToSyp ?? value));
    toast("تم تحديث سعر صرف الدولار مقابل الليرة");
    reload();
  }
  return <>
    <PageHead title="سعر صرف الليرة السورية" sub="السعر المنشور هنا يُستخدم لتحويل الأسعار المعروضة في تطبيق EURO فقط؛ الحسابات والطلبات تبقى بالدولار.">
      <button type="button" className="btn2" onClick={reload}><RefreshCw size={15}/>تحديث</button>
    </PageHead>
    {error && <ErrorBox message={error} onRetry={reload}/>}
    {loading && !data && <Spinner/>}
    <form onSubmit={save} className="card max-w-xl space-y-4">
      <div>
        <label className="mb-2 block text-sm text-white/70" htmlFor="usd-syp-rate">كم ليرة سورية تساوي دولاراً واحداً؟</label>
        <input id="usd-syp-rate" className="inp" type="number" min="1" max="1000000000" step="1" inputMode="numeric" dir="ltr" placeholder="مثال: 12000" value={rate || (current ? String(current) : "")} onChange={(e)=>setRate(e.target.value)} required/>
      </div>
      <p className="text-xs leading-6 text-white/50">السعر يدوي ويجب تحديثه من الإدارة عند تغيّره. لا يتم جلب سعر تلقائي من مصدر خارجي. السعر الحالي: {current ? current.toLocaleString("en-US") + " ل.س لكل 1 USD" : "غير منشور"}.</p>
      <button type="submit" className="btn" disabled={busy || !(rate.trim() || current)}><Save size={16}/>{busy ? "جارٍ الحفظ..." : "حفظ سعر الصرف"}</button>
    </form>
  </>;
}
