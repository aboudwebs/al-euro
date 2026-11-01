"use client";

import { useEffect, useMemo, useState } from "react";

type Props = { code: string; signature: string };

export default function ReferralLanding({ code, signature }: Props) {
  const [attempted, setAttempted] = useState(false);
  const appUrl = useMemo(() => {
    const query = new URLSearchParams();
    if (code) query.set("ref", code);
    if (signature) query.set("sig", signature);
    return `eurocars://referral?${query.toString()}`;
  }, [code, signature]);

  useEffect(() => {
    if (!code || attempted) return;
    const timer = window.setTimeout(() => {
      window.location.href = appUrl;
      setAttempted(true);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [appUrl, attempted, code]);

  const apkUrl = process.env.NEXT_PUBLIC_ANDROID_APK_URL || "https://github.com/aboudwebs/Euro-car.syria/releases/download/mobile-latest/app-release.apk";

  return (
    <main dir="rtl" className="min-h-screen flex items-center justify-center px-5 py-12 text-white bg-[#071426]">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.06] p-7 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-600 text-3xl font-black text-[#071426]">E</div>
        <p className="mb-2 text-sm font-bold tracking-[0.25em] text-amber-300">EURO CARS</p>
        <h1 className="mb-3 text-2xl font-extrabold">دعوة للانضمام إلى اليورو</h1>
        <p className="mb-6 text-sm leading-7 text-slate-300">
          {code ? "تم استلام رابط الدعوة. افتح التطبيق أو ثبّته للمتابعة مع الاحتفاظ بكود الإحالة." : "افتح تطبيق EURO CARS للوصول إلى خدماتنا."}
        </p>
        {code ? <div className="mb-6 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">كود الدعوة: <b dir="ltr" className="text-amber-300">{code}</b></div> : null}
        <a href={appUrl} className="mb-3 block rounded-xl bg-amber-400 px-5 py-3.5 font-extrabold text-[#071426] transition hover:bg-amber-300">
          فتح تطبيق EURO CARS
        </a>
        {apkUrl ? (
          <a href={apkUrl} className="block rounded-xl border border-white/20 px-5 py-3.5 font-bold text-white transition hover:bg-white/10">
            تحميل التطبيق (APK)
          </a>
        ) : (
          <p className="rounded-xl border border-white/10 px-4 py-3 text-xs leading-6 text-slate-400">
            رابط تحميل التطبيق سيظهر هنا بعد ضبط رابط النسخة المنشورة.
          </p>
        )}
        <p className="mt-6 text-xs leading-6 text-slate-500">إذا ثبّت التطبيق الآن، ارجع إلى هذه الصفحة واضغط «فتح تطبيق EURO CARS» لنقل كود الدعوة إليه.</p>
      </section>
    </main>
  );
}
