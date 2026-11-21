import type { Metadata } from "next";
import Link from "next/link";
import DeletionRequestForm from "./DeletionRequestForm";

export const metadata: Metadata = {
  title: "طلب حذف الحساب | EURO CARS",
  description: "صفحة عامة لطلب حذف حساب EURO CARS والتحقق من ملكية الحساب.",
  robots: { index: true, follow: true },
};

export default function DeleteAccountPage() {
  return (
    <main className="min-h-screen bg-[#071217] px-4 py-12 text-white sm:py-16">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-emerald-300 hover:text-emerald-200">EURO CARS</Link>
        <p className="mt-8 text-sm font-bold tracking-[0.18em] text-emerald-300">ACCOUNT DELETION</p>
        <h1 className="mt-3 text-3xl font-black sm:text-4xl">طلب حذف حساب EURO</h1>
        <p className="mt-4 max-w-2xl leading-8 text-white/65">
          يمكنك طلب حذف حسابك من هذه الصفحة دون تسجيل الدخول إلى التطبيق. نتحقق من ملكية الحساب حصراً عبر رمز SMS يُرسل إلى رقم الهاتف المسجّل. لا تتوفر وسيلة تحقق بديلة عبر البريد الإلكتروني.
        </p>

        <DeletionRequestForm />

        <section className="mt-8 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-7 text-white/65">
          <h2 className="text-base font-bold text-white">ماذا يحدث بعد الطلب؟</h2>
          <ul className="list-disc space-y-2 pr-5">
            <li>تبدأ مهلة استرجاع مدتها 30 يوماً من تاريخ تسجيل الطلب.</li>
            <li>يمكنك إلغاء الطلب من داخل التطبيق ما دام تنفيذه لم يكتمل.</li>
            <li>بعد انتهاء مهلة الاسترجاع البالغة 30 يوماً، يُعطّل الحساب وتُزال بيانات الهوية ووسائل تسجيل الدخول والبيانات الشخصية، بما فيها عناوين التسليم المحفوظة والمركبات ورموز الإشعارات وصور الملف الشخصي.</li>
            <li>إذا بقي طلب تجاري قيد التنفيذ، نحتفظ مؤقتاً ببيانات الاتصال أو التسليم الضرورية لإكماله فقط، ونزيلها تلقائياً عند إغلاق الطلب. وتُحذف صور الطلبات الخاصة عند إغلاق الطلب المرتبط بها.</li>
            <li>لا يمنع وجود دين أو رصيد كاش باك أو عمولات أو طلب سحب أو طلب تجاري مفتوح تنفيذ حذف الهوية. نحتفظ بمعرّف داخلي غير قابل لتسجيل الدخول وبالسجلات المالية والتجارية اللازمة لتسوية الالتزامات والمحاسبة، مع فصلها عن الاسم ورقم الهاتف وبيانات الاتصال. طلب الحذف لا يلغي ديناً مستحقاً ولا يسقط مبلغاً مستحقاً للمستخدم.</li>
            <li>إذا كان لك رصيد كاش باك أو عمولات مستحقة لم تُحوّل قبل الحذف، تواصل مع دعم EURO عبر قناة الدعم المنشورة للتحقق من الاستحقاق وترتيب التسوية يدوياً؛ ولا يُعد تعطيل الحساب تنازلاً عن المبلغ المستحق.</li>
            <li>نحتفظ بالسجلات المالية للمدة اللازمة قانونياً ومحاسبياً وتسوية النزاعات، ثم نحذفها أو نجهّلها عندما تنتهي الحاجة المشروعة للاحتفاظ بها.</li>
          </ul>
          <p>إذا لم يعد رقم الهاتف متاحاً لك، أو لم يصلك رمز SMS، أو كان لديك أكثر من حساب مرتبط بالرقم، تواصل مع الدعم للتحقق اليدوي من هويتك.</p>
          <a href="https://wa.me/963982026134?text=%D8%A3%D8%B1%D9%8A%D8%AF%20%D8%B7%D9%84%D8%A8%20%D8%AD%D8%B0%D9%81%20%D8%AD%D8%B3%D8%A7%D8%A8%20EURO" target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg border border-emerald-400/30 px-4 py-2 font-semibold text-emerald-200 hover:bg-emerald-400/10">التواصل مع دعم EURO عبر واتساب</a>
        </section>

        <p className="mt-6 text-sm text-white/50">راجع أيضاً <Link href="/privacy" className="text-emerald-300 underline">سياسة الخصوصية</Link>.</p>
      </div>
    </main>
  );
}
