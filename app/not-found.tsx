import Link from "next/link";

export default function NotFound() {
  return (
    <section className="card mx-auto mt-16 max-w-md p-6 text-center">
      <h1 className="text-xl font-bold text-white">الصفحة غير موجودة</h1>
      <p className="mt-1 text-sm text-white/65">الرابط الذي فتحته غير صحيح أو لم يعد متاحاً.</p>
      <Link className="btn mt-4" href="/">العودة إلى الكتالوج</Link>
    </section>
  );
}
