"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Plus, ScanLine } from "lucide-react";
import { BRANDS, usd } from "@/lib/data";
import { useParts } from "@/lib/useParts";
import { useCart } from "@/components/cart";
import { H } from "@/components/ui";

export default function Home() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [b, setB] = useState("");
  const { add } = useCart();
  const { parts, loading, error, reload } = useParts();

  const vin = q.trim().length === 17;
  const s = q.trim().toLowerCase();

  const brandList = Array.from(new Set([...BRANDS, ...parts.map((x) => x.brand)]));

  const r = parts.filter(
    (x) =>
      (!b || x.brand === b) &&
      (!s ||
        vin ||
        x.name.includes(q.trim()) ||
        x.pn.toLowerCase().includes(s))
  );

  return (
    <>
      <H
        t="متجر اليورو"
        s="ابحث برقم القطعة أو رقم الشاصي واحصل على السعر فورًا"
      />

      <div className="relative">
        <Search
          className="absolute start-3 top-3.5 text-white/40"
          size={18}
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="رقم القطعة أو رقم الشاصي (VIN)…"
          className="w-full rounded-2xl border border-white/[0.10] bg-black/35 py-3 pe-4 ps-10 text-white backdrop-blur-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all placeholder:text-white/40 focus:border-[#0A84FF] focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/25"
        />
      </div>

      {vin && (
        <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-[#30D158]/35 bg-[#30D158]/15 px-3 py-1 text-xs font-medium text-[#30D158]">
          <ScanLine size={16} />
          تم حفظ رقم الشاصي وسيُربط بالقطع المطلوبة تلقائيًا
        </p>
      )}

      <div className="my-4 flex gap-1 overflow-x-auto rounded-2xl border border-white/[0.08] bg-black/40 p-1.5 backdrop-blur-xl shadow-inner">
        {["", ...brandList].map((x) => (
          <button
            key={x}
            onClick={() => setB(x)}
            className={`shrink-0 rounded-xl border px-4 py-1.5 text-sm transition-all ${
              b === x
                ? "border-white/[0.22] bg-white/[0.15] font-semibold text-white backdrop-blur-md shadow-[0_4px_12px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.3)]"
                : "border-transparent text-white/60 hover:bg-white/[0.05] hover:text-white"
            }`}
          >
            {x || "الكل"}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {r.map((p) => (
          <article
            key={p.id}
            role="link"
            tabIndex={0}
            aria-label={"عرض تفاصيل " + p.name}
            onClick={() => router.push("/product/" + p.id)}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); router.push("/product/" + p.id); } }}
            className="flex cursor-pointer flex-col gap-1 rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-4 backdrop-blur-2xl transition-colors duration-200 hover:border-[#0A84FF]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]"
          >
            <span className="text-xs font-medium text-[#0A84FF]">{p.brand}</span>
            <b className="font-semibold tracking-tight text-white">{p.name}</b>

            <code className="text-xs text-white/45" dir="ltr">
              {p.pn}
            </code>

            <div className="mt-auto flex items-center justify-between pt-3">
              <span className="text-lg font-semibold tracking-tight text-white">
                {usd(p.price)}
              </span>

              {p.stock ? (
                <button
                  className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-[#3A9BFD] to-[#007AFF] px-3 py-2 text-sm font-semibold text-snow shadow-[0_4px_20px_rgba(0,122,255,0.45),inset_0_1px_1px_rgba(255,255,255,0.45)] transition-all hover:brightness-110 active:scale-[0.97]"
                  onClick={(e) => { e.stopPropagation(); add(p.id); }}
                >
                  <Plus size={16} />
                  أضف للسلة
                </button>
              ) : (
                <Link
                  href="/special"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center rounded-full border border-white/[0.16] bg-white/[0.08] px-3 py-2 text-xs text-white backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-all hover:bg-white/[0.14] active:scale-[0.97]"
                >
                  غير متوفرة — اطلبها
                </Link>
              )}
            </div>
            <span className="mt-2 text-xs text-white/55">اضغط لعرض التفاصيل والتوافق</span>
          </article>
        ))}
      </div>

      {loading && <p className="my-6 text-center text-sm text-white/65">جارٍ تحميل الكتالوج...</p>}

      {!loading && error && (
        <p role="alert" className="my-4 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-[#FF453A]/40 bg-[#FF453A]/15 p-3 text-sm text-[#FF6961]">
          {error}
          <button type="button" onClick={reload} className="underline">إعادة المحاولة</button>
        </p>
      )}

      {!loading && !r.length && (
        <div className="rounded-[24px] border border-white/[0.14] bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-6 text-center text-white/65 backdrop-blur-2xl saturate-150 shadow-[0_10px_32px_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.25)] transition-all duration-300">
          <p>لم تجد القطعة؟ نؤمّنها لك ولو من خارج البلد.</p>
          <Link
            href="/special"
            className="mt-3 inline-flex items-center justify-center rounded-full bg-gradient-to-b from-[#3A9BFD] to-[#007AFF] px-5 py-2.5 text-sm font-semibold text-snow shadow-[0_4px_20px_rgba(0,122,255,0.45),inset_0_1px_1px_rgba(255,255,255,0.45)] transition-all hover:brightness-110 active:scale-[0.97]"
          >
            ارفعها كطلب خاص
          </Link>
        </div>
      )}
    </>
  );
}
