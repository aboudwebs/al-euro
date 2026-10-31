"use client";
import {useEffect, useState} from "react";
import {Copy,Check,MessageCircle,Users} from "lucide-react";
import {usd} from "@/lib/data";
import {H} from "@/components/ui";

type Dashboard = {
  marketer: { name: string; code: string; referralUrl: string };
  workshops: number;
  commissions: { available: number; held: number; paid: number; total: number };
};

export default function M(){
  const [cp, setCp] = useState(false);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/marketer/dashboard", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "تعذر تحميل لوحة المسوّق");
        return d as Dashboard;
      })
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "تعذر تحميل البيانات"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const link = data?.marketer.referralUrl ?? "";

  return(
    <>
      <H t="لوحة المسوّق" s="عمولة 2% على طلبات الورشات المسجّلة عبر رابطك"/>

      {error && <div role="alert" className="mb-4 rounded-2xl border border-[#FF453A]/40 bg-[#FF453A]/10 p-3 text-sm text-[#FF9F0A]">{error}</div>}
      {loading && <p className="mb-4 text-sm text-white/60">جارٍ تحميل بيانات حسابك الفعلية...</p>}

      <div className="rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4 backdrop-blur-2xl saturate-150 shadow-[0_10px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.25)]">
        <p className="mb-2 text-sm text-white/65">رابط الدعوة الخاص بك</p>
        <div className="flex flex-wrap gap-2">
          <input readOnly value={link} placeholder={loading ? "جارٍ تحميل الرابط..." : "لا يوجد كود دعوة لحسابك"} dir="ltr"
            className="w-full min-w-0 flex-1 rounded-2xl border border-white/[0.10] bg-black/35 px-3 py-2.5 text-sm text-white outline-none backdrop-blur-xl placeholder:text-white/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all focus:border-[#0A84FF] focus:ring-2 focus:ring-[#0A84FF]/25"/>
          <button disabled={!link} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.16] bg-white/[0.08] px-4 py-2.5 text-sm text-white disabled:opacity-40"
            onClick={async()=>{try{await navigator.clipboard.writeText(link);setCp(true);window.setTimeout(()=>setCp(false),1800);}catch{setError("تعذر نسخ الرابط؛ انسخه يدوياً من الحقل.");}}}>
            {cp ? <Check size={16}/> : <Copy size={16}/>} {cp ? "تم النسخ" : "نسخ"}
          </button>
          <a aria-disabled={!link} className={`${link ? "" : "pointer-events-none opacity-50 "}inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#3A9BFD] to-[#007AFF] px-4 py-2.5 text-sm font-semibold text-white`}
            target="_blank" rel="noreferrer" href={link ? `https://wa.me/?text=${encodeURIComponent("سجّل ورشتك في اليورو: "+link)}` : undefined}>
            <MessageCircle size={16}/> مشاركة عبر واتساب
          </a>
        </div>
        {data?.marketer.code && <p className="mt-2 text-xs text-white/45">كود الدعوة: {data.marketer.code}</p>}
      </div>

      <div className="my-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4">
          <p className="text-sm text-white/65">عمولات متاحة للدفع</p>
          <b className="text-2xl font-semibold tracking-tight text-[#30D158]">{usd(data?.commissions.available ?? 0)}</b>
        </div>
        <div className="rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4">
          <p className="text-sm text-white/65">عمولات معلّقة حتى تسديد الدين</p>
          <b className="text-2xl font-semibold tracking-tight text-white">{usd(data?.commissions.held ?? 0)}</b>
        </div>
        <div className="rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4">
          <p className="text-sm text-white/65">إجمالي الورشات المرتبطة</p>
          <b className="text-2xl font-semibold tracking-tight text-white">{data?.workshops ?? 0}</b>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4">
        <div className="rounded-xl border border-white/[0.14] bg-[#0A84FF]/15 p-3 text-[#0A84FF]"><Users size={24}/></div>
        <div>
          <h3 className="font-semibold tracking-tight text-white">شبكة ورشاتك</h3>
          <p className="text-xs text-white/55">إجمالي العمولات المسجّلة: {usd(data?.commissions.total ?? 0)} · المدفوع منها: {usd(data?.commissions.paid ?? 0)}</p>
          <p className="mt-1 text-xs text-white/45">تُسجّل العمولة بعد تسليم الطلب. عمولات طلبات الدين تبقى معلّقة حتى تسديد دين الورشة بالكامل.</p>
        </div>
      </div>
    </>
  );
}
