"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Pause, Save, Search } from "lucide-react";
import { api, Badge, Empty, ErrorBox, fmtDate, money, PageHead, Spinner, Tabs, toast, useApi } from "@/components/admin/kit";
import type { AdminAccount } from "@/lib/admin-types";
import { ROLE_LABEL, TIER_LABEL, type Tier } from "@/lib/status";

type Role = "all" | "workshop" | "marketer";
type State = "all" | "active" | "inactive";

function AccountCard({ a, onChanged }: { a: AdminAccount; onChanged: () => void }) {
  const [limit, setLimit] = useState(String(Number(a.debt_limit) || 0));
  const [busy, setBusy] = useState(false);
  const [workshopName, setWorkshopName] = useState(a.license_verification_workshop_name || "");
  const [workshopAddress, setWorkshopAddress] = useState(a.license_verification_address || "");
  const [evidence, setEvidence] = useState(a.license_verification_evidence || "");
  const [verificationNotes, setVerificationNotes] = useState(a.license_verification_notes || "");
  const isWorkshop = a.role === "workshop";
  const isManualVerificationAccount = isWorkshop && !a.license;
  const needsManualVerification = isManualVerificationAccount && a.license_verification_status !== "verified";
  const dirty = isWorkshop && Number(limit) !== (Number(a.debt_limit) || 0);

  useEffect(() => {
    setLimit(String(Number(a.debt_limit) || 0));
  }, [a.debt_limit]);

  async function patch(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    const r = await api(`/api/admin/accounts/${a.id}`, { method: "PATCH", body });
    setBusy(false);
    if (!r.ok) return toast(r.error, "err");
    toast(okMsg);
    onChanged();
  }

  const tier = (a.tier as Tier) || "Bronze";

  return (
    <article className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-white">{a.name}</h3>
          <p className="text-sm text-white/65" dir="ltr" style={{ textAlign: "right" }}>{a.phone}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={isWorkshop ? "info" : "gold"}>{ROLE_LABEL[a.role]}</Badge>
          <Badge tone={a.is_active ? "ok" : "warn"}>{a.is_active ? "مفعّل" : "غير مفعّل"}</Badge>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <div><dt className="text-xs text-white/45">المدينة</dt><dd className="text-white">{a.city || "—"}</dd></div>
        <div><dt className="text-xs text-white/45">تاريخ التسجيل</dt><dd className="text-white">{fmtDate(a.created_at)}</dd></div>
        {isWorkshop && <div><dt className="text-xs text-white/45">رقم الترخيص</dt><dd className="text-white">{a.license || "لا يوجد — تحقق يدوي"}</dd></div>}
        {isManualVerificationAccount && <div><dt className="text-xs text-white/45">حالة التحقق</dt><dd className="text-white">{a.license_verification_status === "verified" ? "تم التحقق" : a.license_verification_status === "rejected" ? "تعذر التحقق" : "بانتظار التحقق"}</dd></div>}
        {isManualVerificationAccount && a.license_verification_reviewed_at && <div><dt className="text-xs text-white/45">تاريخ المراجعة</dt><dd className="text-white">{fmtDate(a.license_verification_reviewed_at)}</dd></div>}
        {isWorkshop && <div><dt className="text-xs text-white/45">الاختصاص</dt><dd className="text-white">{a.specs?.length ? a.specs.join("، ") : "—"}</dd></div>}
        {isWorkshop && <div><dt className="text-xs text-white/45">أُحيلت بواسطة</dt><dd className="text-white">{a.referred_by_code ? `${a.referred_by_name ?? "—"} (${a.referred_by_code})` : "—"}</dd></div>}
        {!isWorkshop && <div><dt className="text-xs text-white/45">كود الإحالة</dt><dd className="text-white" dir="ltr" style={{ textAlign: "right" }}>{a.my_ref_code || "—"}</dd></div>}
        {isWorkshop && <div><dt className="text-xs text-white/45">الدين الحالي</dt><dd className={Number(a.debt_balance) > 0 ? "font-semibold text-[#FF9F0A]" : "text-white"}>{money(a.debt_balance)}</dd></div>}
      </dl>

      {needsManualVerification && (
        <div className="space-y-2 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm">
          <p className="font-semibold text-amber-200">التحقق اليدوي من هوية صاحب الورشة</p>
          <p className="text-xs leading-6 text-white/65">يتواصل الدعم مع صاحب الحساب عبر الرقم المسجل، ويتحقق من اسم الورشة وموقعها ويطلب صورة الواجهة أو فيديو مباشر. سجّل نتيجة التحقق هنا. لا تفعّل الحساب قبل اكتمال الأدلة.</p>
          <label className="block space-y-1 text-xs text-white/65">اسم الورشة
            <input className="inp" value={workshopName} onChange={(e) => setWorkshopName(e.target.value)} placeholder="اسم الورشة كما يظهر على الواجهة" />
          </label>
          <label className="block space-y-1 text-xs text-white/65">العنوان الدقيق
            <input className="inp" value={workshopAddress} onChange={(e) => setWorkshopAddress(e.target.value)} placeholder="المحافظة، المنطقة، الشارع" />
          </label>
          <label className="block space-y-1 text-xs text-white/65">أدلة التحقق
            <textarea className="inp min-h-20" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="مثال: تمت مطابقة الواجهة واللافتة مع الموقع، وتم التحدث مع صاحب الورشة..." />
          </label>
          <label className="block space-y-1 text-xs text-white/65">ملاحظات / سبب الرفض
            <textarea className="inp min-h-16" value={verificationNotes} onChange={(e) => setVerificationNotes(e.target.value)} placeholder="ملاحظات الدعم أو سبب تعذر التحقق" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !workshopName.trim() || !workshopAddress.trim() || !evidence.trim()} className="btn" onClick={() => patch({ license_verification_status: "verified", license_verification_workshop_name: workshopName, license_verification_address: workshopAddress, license_verification_evidence: evidence, license_verification_notes: verificationNotes }, "تم توثيق التحقق وتفعيل الورشة") }><Check size={15} />تأكيد الهوية وتفعيل الحساب</button>
            <button type="button" disabled={busy || !verificationNotes.trim()} className="inline-flex items-center gap-1.5 rounded-full border border-[#FF453A]/40 bg-[#FF453A]/10 px-4 py-2 text-sm font-semibold text-[#FF6961]" onClick={() => patch({ license_verification_status: "rejected", license_verification_workshop_name: workshopName, license_verification_address: workshopAddress, license_verification_evidence: evidence, license_verification_notes: verificationNotes }, "تم تسجيل تعذر التحقق")}>تعذر التحقق</button>
          </div>
          {a.license_verification_notes && <p className="text-xs text-white/55">آخر ملاحظة: {a.license_verification_notes}</p>}
        </div>
      )}

      {isWorkshop && (
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/30 p-3 text-sm">
          <div><p className="text-xs text-white/45">مرتبة الولاء الحالية</p><p className="font-semibold text-white">{TIER_LABEL[tier]}</p></div>
          <div><p className="text-xs text-white/45">رصيد الكاش باك المتاح</p><p className="font-semibold text-white">{money(a.cashback_balance)}</p></div>
          <div className="col-span-2"><p className="text-xs text-white/45">مشتريات دورة الـ90 يوم</p><p className="font-semibold text-white">{money(a.loyalty_season_spend)}</p></div>
          <label className="col-span-2 space-y-1 text-xs text-white/65">
            سقف الدين ($)
            <input className="inp" type="number" min={0} step="1" inputMode="decimal" dir="ltr" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </label>
          <button type="button" disabled={!dirty || busy} className="btn col-span-2" onClick={() => patch({ debt_limit: Number(limit) }, "تم حفظ سقف الدين")}>
            <Save size={15} />حفظ سقف الدين
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {a.is_active ? (
          <button type="button" disabled={busy} className="inline-flex items-center gap-1.5 rounded-full border border-[#FF453A]/40 bg-[#FF453A]/10 px-4 py-2 text-sm font-semibold text-[#FF6961] hover:bg-[#FF453A]/20" onClick={() => { if (confirm(`تعليق حساب «${a.name}»؟ لن يتمكن من تسجيل الدخول.`)) patch({ is_active: false }, "تم تعليق الحساب"); }}>
            <Pause size={15} />تعليق الحساب
          </button>
        ) : needsManualVerification ? (
          <span className="text-xs text-amber-200">لا يمكن التفعيل قبل إكمال التحقق اليدوي أعلاه.</span>
        ) : (
          <button type="button" disabled={busy} className="btn" onClick={() => patch({ is_active: true }, "تم تفعيل الحساب")}>
            <Check size={15} />تفعيل الحساب
          </button>
        )}
      </div>
    </article>
  );
}

function AccountsInner() {
  const sp = useSearchParams();
  const [role, setRole] = useState<Role>("all");
  const [state, setState] = useState<State>((sp.get("status") as State) === "inactive" ? "inactive" : "all");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const params = new URLSearchParams();
  if (role !== "all") params.set("role", role);
  if (state !== "all") params.set("status", state);
  if (dq) params.set("q", dq);
  const { data, error, loading, reload } = useApi<{ accounts: AdminAccount[] }>(`/api/admin/accounts?${params}`);
  const list = data?.accounts ?? [];

  return (
    <>
      <PageHead title="الشركات والورشات" sub="التحقق من التسجيلات، تفعيل أو تعليق الحسابات، ومتابعة الولاء والكاش باك وسقف الدين" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs<Role> value={role} onChange={setRole} items={[{ value: "all", label: "الكل" }, { value: "workshop", label: "ورشات" }, { value: "marketer", label: "مسوّقون" }]} />
        <Tabs<State> value={state} onChange={setState} items={[{ value: "all", label: "كل الحالات" }, { value: "inactive", label: "بانتظار التفعيل" }, { value: "active", label: "مفعّلة" }]} />
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-white/45" />
          <input className="inp pe-9" placeholder="بحث بالاسم أو الهاتف أو المدينة" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && !list.length && <Empty>لا توجد حسابات مطابقة.</Empty>}
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {list.map((a) => <AccountCard key={a.id} a={a} onChanged={reload} />)}
      </div>
    </>
  );
}

export default function AccountsPage() {
  return <Suspense fallback={<Spinner />}><AccountsInner /></Suspense>;
}
