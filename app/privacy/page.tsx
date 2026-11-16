import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "سياسة الخصوصية | EURO CARS",
  description: "سياسة الخصوصية وحماية بيانات مستخدمي تطبيق EURO CARS.",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#071217] px-4 py-12 text-white sm:py-16">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-emerald-300 hover:text-emerald-200">EURO CARS</Link>
        <p className="mt-8 text-sm font-bold tracking-[0.18em] text-emerald-300">PRIVACY POLICY</p>
        <h1 className="mt-3 text-3xl font-black sm:text-4xl">سياسة الخصوصية</h1>
        <p className="mt-3 text-sm text-white/45">آخر تحديث: 16 تشرين الثاني 2026</p>
        <p className="mt-6 leading-8 text-white/70">
          توضح هذه السياسة كيفية جمع واستخدام وحماية البيانات عند استخدام تطبيق وخدمات EURO CARS المخصصة لقطع غيار السيارات والورش والمسوّقين.
        </p>

        <div className="mt-8 space-y-8 text-sm leading-8 text-white/70">
          <section>
            <h2 className="mb-2 text-lg font-bold text-white">1. الجهة المسؤولة والتواصل</h2>
            <p>الجهة المشغّلة: شركة اليورو (EURO CARS).</p>
            <p>العنوان: إدلب، سرمدا، سوريا.</p>
            <p>للاستفسارات المتعلقة بالخصوصية أو البيانات، تواصل مع الدعم عبر واتساب على الرقم <span dir="ltr" className="inline-block">+963 982 026 134</span>.</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">2. البيانات التي نجمعها</h2>
            <ul className="list-disc space-y-2 pr-5">
              <li><strong className="text-white">بيانات الحساب والاتصال:</strong> الاسم، رقم الهاتف، البريد الإلكتروني عند ربطه بمزوّد تسجيل الدخول، نوع الحساب، المحافظة وبيانات الترخيص أو التحقق اليدوي للورشة.</li>
              <li><strong className="text-white">بيانات الطلبات:</strong> قطع الغيار المطلوبة، أرقام القطع، رقم VIN الذي تدخله أو تحفظه، عناوين التسليم، سجل الطلبات وحالاتها.</li>
              <li><strong className="text-white">البيانات المالية:</strong> طرق الدفع المختارة، إيصالات شام كاش، سجل الديون والتسديد، أرصدة الكاش باك والولاء، عمولات المسوّقين وطلبات السحب وبيانات المحفظة التي تقدمها للسحب.</li>
              <li><strong className="text-white">الصور والملفات:</strong> صورة الملف الشخصي، صور الطلبات الخاصة، إيصالات الدفع، ومستندات أو أدلة التحقق التي تختار رفعها.</li>
              <li><strong className="text-white">بيانات التشغيل:</strong> رموز إشعارات الجهاز اللازمة لإرسال تحديثات الطلبات والحساب، وسجلات تقنية وأمنية محدودة لحماية الخدمة ومنع إساءة الاستخدام.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">3. الكاميرا وبيانات الموقع</h2>
            <p>يستخدم التطبيق الكاميرا اختيارياً لقراءة رقم VIN. تتم قراءة النص على الجهاز، ولا تُرفع صورة المسح إلى الخادم من شاشة قارئ VIN. إذا اخترت لاحقاً رفع صورة لطلب خاص أو إيصال أو ملف شخصي، فستُرسل الصورة اللازمة لهذه الميزة.</p>
            <p>لا يطلب التطبيق الوصول إلى موقع GPS الدقيق. قد تدخل المحافظة أو عنوان التسليم يدوياً لاستخدامهما في تنفيذ الطلب.</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">4. كيف نستخدم البيانات</h2>
            <ul className="list-disc space-y-2 pr-5">
              <li>إنشاء الحساب والتحقق من ملكيته وتسجيل الدخول وإدارة صلاحياته.</li>
              <li>البحث عن قطع الغيار وإدارة الطلبات والتوصيل والطلبات الخاصة وخدمة العملاء.</li>
              <li>إدارة المدفوعات اليدوية وسجلات الديون والتسديد والكاش باك والولاء والعمولات وطلبات السحب.</li>
              <li>إرسال إشعارات حالة الطلب، والتنبيهات المالية والأمنية المهمة.</li>
              <li>منع الاحتيال وإساءة الاستخدام، وحماية الخدمة، والوفاء بالالتزامات المحاسبية والقانونية.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">5. مزوّدو الخدمات ومشاركة البيانات</h2>
            <p>لا نبيع البيانات الشخصية. نشارك الحد الأدنى اللازم مع مزوّدي التقنية الذين يشغّلون الخدمة، ومنهم Supabase لاستضافة قاعدة البيانات والملفات، وRender لاستضافة الخادم، وFirebase للمصادقة والإشعارات، وMsgPlus لإرسال رسائل التحقق النصية، وResend لإرسال رسائل البريد المرتبطة بالحساب عند الحاجة. وقد نكشف بيانات محددة إذا تطلب القانون ذلك أو لحماية الحقوق ومنع الاحتيال.</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">6. حماية البيانات</h2>
            <p>نستخدم اتصال HTTPS، ونقيّد الوصول إلى بيانات الخادم وقاعدة البيانات بحسب صلاحيات التشغيل، ونطبق ضوابط للتحقق من الحسابات والحد من محاولات إساءة الاستخدام. لا توجد وسيلة نقل أو تخزين إلكتروني تضمن أماناً مطلقاً، لذلك لا تشارك رموز التحقق أو كلمات المرور مع أي شخص.</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">7. الاحتفاظ بالبيانات وحذف الحساب</h2>
            <p>يمكنك طلب حذف حسابك من داخل التطبيق أو من صفحة <Link href="/delete-account" className="text-emerald-300 underline">طلب حذف الحساب</Link>. نتحقق من ملكية الحساب قبل تسجيل الطلب، وتبدأ بعده مهلة استرجاع مدتها 30 يوماً يمكن خلالها إلغاء الطلب من التطبيق.</p>
            <p>بعد انتهاء المهلة، تُزال أو تُخفى البيانات الشخصية، وتُحذف هويات تسجيل الدخول ورموز الإشعارات والصور المرتبطة بالحساب وفق إجراءات التنظيف. قد نحتفظ بالسجلات المالية الضرورية للمحاسبة وتسوية النزاعات أو الالتزامات القانونية. لا يمكن إتمام الحذف قبل تسوية الديون واستخدام رصيد الكاش باك والطلبات قيد التنفيذ والعمولات أو طلبات السحب غير المسوّاة.</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">8. خياراتك وحقوقك</h2>
            <p>يمكنك مراجعة بيانات حسابك وتحديث البيانات المتاحة من داخل التطبيق، وطلب تصحيح بيانات غير دقيقة أو حذف الحساب. إذا فقدت الوصول إلى رقم الهاتف المسجّل، تواصل مع الدعم عبر واتساب للتحقق اليدوي من هويتك.</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-white">9. التغييرات على هذه السياسة</h2>
            <p>قد نحدّث هذه السياسة عند إضافة ميزات أو تغيير طريقة معالجة البيانات. سننشر النسخة المحدّثة في هذه الصفحة مع تعديل تاريخ آخر تحديث.</p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="mb-2 text-lg font-bold text-white">تواصل معنا</h2>
            <p>شركة اليورو — إدلب، سرمدا، سوريا.</p>
            <a href="https://wa.me/963982026134" target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-300 underline">دعم EURO عبر واتساب: +963 982 026 134</a>
          </section>
        </div>

        <p className="mt-8 text-xs leading-6 text-white/40">هذه السياسة تصف ممارسات خدمات EURO CARS كما هي حالياً. لا تشارك بيانات تسجيل الدخول أو رموز التحقق مع الآخرين.</p>
      </article>
    </main>
  );
}
