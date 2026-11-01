"use client";
import { RefreshCw } from "lucide-react";
import { ErrorBox, PageHead, Spinner, useApi } from "@/components/admin/kit";

type CurrencyData = {
  usdToSyp: number | null;
  rateUpdatedAt: string | null;
  sourceUpdatedAt?: string | null;
  rateSource?: string;
  sypUnit?: "new";
  rateStatus?: "fresh" | "stale" | "unavailable";
  providerStatus?: "fresh" | "cached";
  rateAgeSeconds?: number;
  canUseSypPayments?: boolean;
  rateError?: string;
};

export default function CurrencySettingsPage() {
  const { data, error, loading, reload } = useApi<CurrencyData>("/api/settings");

  const updated = data?.rateUpdatedAt
    ? new Date(data.rateUpdatedAt).toLocaleString("ar-SY")
    : "غير متوفر";
  const statusLabel = data?.rateStatus === "fresh"
    ? "السعر حديث"
    : data?.rateStatus === "stale"
      ? "السعر مخزّن أو قديم — لا يُعتمد للدفع بالليرة"
      : "تعذر جلب السعر";

  return <>
    <PageHead title="سعر صرف الليرة السورية" sub="يُجلب سعر بيع الدولار مباشرة من SYR Rates API. الأسعار والطلبات الأساسية تبقى بالدولار.">
      <button type="button" className="btn2" onClick={reload}><RefreshCw size={15}/>تحديث</button>
    </PageHead>
    {error && <ErrorBox message={error} onRetry={reload}/>}
    {loading && !data && <Spinner/>}
    {data && <section className="card max-w-xl space-y-4">
      <div>
        <p className="text-sm text-white/55">سعر بيع الدولار مقابل الليرة الجديدة</p>
        <p className="mt-1 text-3xl font-semibold text-gold">
          {data.usdToSyp ? data.usdToSyp.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}
          <span className="ms-2 text-base font-normal text-white/60">ل.س لكل 1 USD</span>
        </p>
      </div>
      <div className="space-y-2 text-sm">
        <p className="text-white/75">المصدر: SYR Rates API (@api365)</p>
        <p className="text-white/55">آخر قبول للسعر: {updated}</p>
        <p className={data.canUseSypPayments ? "text-emerald-400" : "text-amber-400"}>{statusLabel}</p>
        {typeof data.rateAgeSeconds === "number" && <p className="text-white/45">عمر السعر: {Math.floor(data.rateAgeSeconds / 60)} دقيقة</p>}
      </div>
      {!data.usdToSyp && <p className="text-sm text-amber-400">تحقق من ضبط SYR_API_KEY في متغيرات بيئة خادم Render.</p>}
    </section>}
  </>;
}
