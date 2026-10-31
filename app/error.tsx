"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card mx-auto mt-16 max-w-md p-6 text-center" role="alert">
      <h1 className="text-xl font-bold text-white">حدث خطأ غير متوقع</h1>
      <p className="mt-1 text-sm text-white/65">تعذر تحميل هذه الصفحة. حاول مرة أخرى.</p>
      <button type="button" className="btn mt-4" onClick={() => reset()}>إعادة المحاولة</button>
    </section>
  );
}
