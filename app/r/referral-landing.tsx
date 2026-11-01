"use client";

import { useEffect, useMemo, useState } from "react";

type Props = { code: string; signature: string; autoLaunch: boolean };

export default function ReferralLanding({ code, signature, autoLaunch }: Props) {
  const [attempted, setAttempted] = useState(false);
  const appUrl = useMemo(() => {
    const query = new URLSearchParams();
    if (code) query.set("ref", code);
    if (signature) query.set("sig", signature);
    const queryString = query.toString();
    const fallback = `https://al-euro-cdzo.onrender.com/r?${queryString}&launch=0`;
    return `intent://referral?${queryString}#Intent;scheme=eurocars;package=com.eurocars.euro_cars;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  }, [code, signature]);

  useEffect(() => {
    if (!autoLaunch || !code || attempted) return;
    const timer = window.setTimeout(() => {
      window.location.href = appUrl;
      setAttempted(true);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [appUrl, attempted, autoLaunch, code]);

  return (
    <main dir="rtl" className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#06080E] px-5 py-12 text-white">
      <div aria-hidden="true" className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full bg-[#0A84FF]/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-36 -left-24 h-96 w-96 rounded-full bg-[#5E5CE6]/10 blur-3xl" />

      <section className="relative w-full max-w-[430px] rounded-[30px] border border-white/10 bg-white/[0.045] p-7 text-center shadow-[0_24px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:p-9">
        <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center overflow-hidden rounded-[26px] border border-white/10 bg-[#0B0F1A] shadow-[0_10px_35px_rgba(10,132,255,0.14)]">
          <img
            src="https://raw.githubusercontent.com/aboudwebs/Euro-car.syria/main/branding/icon_1024.png"
            alt="أيقونة تطبيق EURO CARS"
            width={96}
            height={96}
            className="h-full w-full object-cover"
          />
        </div>

        <p dir="ltr" className="mb-3 text-xs font-extrabold tracking-[0.32em] text-[#60AFFF]">EURO CARS</p>
        <h1 className="mb-3 text-2xl font-extrabold leading-tight sm:text-[28px]">
          {code ? "أنت مدعو للانضمام إلى EURO CARS" : "افتح تطبيق EURO CARS"}
        </h1>
        <p className="mx-auto mb-7 max-w-sm text-sm leading-7 text-white/65">
          {code
            ? "تم استلام دعوة المسوّق. افتح التطبيق للمتابعة، وسيبقى رمز الدعوة محفوظاً أثناء إنشاء حساب الورشة."
            : "تابع إلى التطبيق للوصول إلى خدمات قطع السيارات الأوروبية."}
        </p>

        {code ? (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-[#0A84FF]/25 bg-[#0A84FF]/[0.08] px-4 py-3.5 text-sm">
            <span className="text-white/60">رمز الدعوة</span>
            <b dir="ltr" className="font-bold tracking-wide text-[#72B7FF]">{code}</b>
          </div>
        ) : null}

        <a
          href={appUrl}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#3A9BFD] to-[#007AFF] px-5 py-4 font-extrabold text-white shadow-[0_8px_26px_rgba(0,122,255,0.24)] transition hover:brightness-110 active:scale-[0.99]"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3h7v7" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
          </svg>
          فتح تطبيق EURO CARS
        </a>

        <p className="mt-6 text-xs leading-6 text-white/40">
          {code
            ? "إذا لم يفتح التطبيق، تأكد من تثبيته ثم ارجع إلى هذه الصفحة واضغط زر الفتح مرة أخرى."
            : "إذا لم يكن التطبيق مثبتاً على جهازك، ستحتاج إلى تثبيته قبل المتابعة."}
        </p>
        <div className="mx-auto mt-7 h-px w-16 bg-gradient-to-l from-transparent via-white/20 to-transparent" />
        <p className="mt-4 text-[11px] font-medium tracking-wide text-white/30">EURO CARS · قطع السيارات الأوروبية</p>
      </section>
    </main>
  );
}
