"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Package, ShoppingCart } from "lucide-react";
import { usd } from "@/lib/data";
import { useParts } from "@/lib/useParts";
import { useCart } from "@/components/cart";
import { H } from "@/components/ui";

export default function ProductDetails() {
  const params = useParams<{ id: string }>();
  const { add } = useCart();
  const { parts, loading, error } = useParts();

  // Part ids are text in the database; only safe id characters are looked up.
  const rawId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const part = rawId && /^[A-Za-z0-9_-]{1,64}$/.test(rawId)
    ? parts.find((item) => item.id === rawId)
    : undefined;

  if (loading) return <p className="my-10 text-center text-sm text-white/65">جارٍ تحميل تفاصيل القطعة...</p>;

  if (!part && error) return (
    <section className="card mx-auto max-w-2xl p-6 text-center" role="alert">
      <h1 className="text-xl font-bold text-white">تعذر تحميل القطعة</h1>
      <p className="mt-1 text-sm text-white/65">{error}</p>
      <Link className="btn mt-4" href="/">العودة إلى الكتالوج</Link>
    </section>
  );

  if (!part) return (
    <section className="card mx-auto max-w-2xl p-6 text-center">
      <Package className="mx-auto mb-3 text-white/60" size={32} />
      <h1 className="text-xl font-bold text-white">القطعة غير موجودة</h1>
      <Link className="btn mt-4" href="/">العودة إلى الكتالوج</Link>
    </section>
  );

  const inStock = part.stock > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-[#0A84FF]"><ArrowRight size={17}/>العودة إلى الكتالوج</Link>
      <H t={part.name} s="تفاصيل القطعة والسعر والتوافق مع السيارات" />
      <section className="card p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-[#0A84FF]">رقم القطعة</p>
            <code dir="ltr" className="text-lg font-semibold text-white">{part.pn}</code>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-sm font-medium ${
              inStock
                ? "border-[#30D158]/35 bg-[#30D158]/15 text-[#30D158]"
                : "border-[#FF9F0A]/35 bg-[#FF9F0A]/15 text-[#FF9F0A]"
            }`}
          >
            {inStock ? "متوفرة" : "غير متوفرة"}
          </span>
        </div>
        <div className="mb-5 flex items-center justify-between border-y border-[color:var(--line)] py-4">
          <span className="text-sm text-white/65">السعر</span>
          <strong className="text-2xl text-[#0A84FF]">{usd(part.price)}</strong>
        </div>
        <div className="space-y-2">
          <h2 className="font-bold text-white">الماركة الأساسية</h2>
          <p className="text-white/80">{part.brand}</p>
        </div>
        <div className="mt-5 rounded-2xl border border-[#0A84FF]/30 bg-[#0A84FF]/10 p-4">
          <h2 className="mb-2 flex items-center gap-2 font-bold text-white"><CheckCircle2 size={18} className="text-[#0A84FF]"/>التوافق مع السيارات</h2>
          {part.model || part.years ? (
            <p className="text-sm leading-6 text-white/80">{[part.model, part.years].filter(Boolean).join(" · ")}</p>
          ) : (
            <p className="text-sm leading-6 text-white/80">قائمة الموديلات والسنوات المتوافقة غير مسجّلة لهذه القطعة، لذلك لن نعرض توافقاً غير مؤكّد. أرسل رقم الشاصي (VIN) أو اطلب مطابقة رقم القطعة للتأكد من توافقها مع سيارتك قبل الشراء.</p>
          )}
          {part.altGrade && <p className="mt-2 text-sm text-white/65">درجة البديل: {part.altGrade}</p>}
          <Link href="/special" className="mt-3 inline-flex text-sm font-semibold text-[#0A84FF]">طلب مطابقة أو قطعة خاصة</Link>
        </div>
        {inStock ? (
          <button type="button" onClick={() => add(part.id)} className="btn mt-5 w-full py-3"><ShoppingCart size={18}/>إضافة للسلة</button>
        ) : (
          <Link href="/special" className="btn mt-5 w-full py-3">اطلب القطعة</Link>
        )}
      </section>
    </div>
  );
}
