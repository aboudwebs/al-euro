"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Pause, Save, Search } from "lucide-react";
import { api, Badge, Empty, ErrorBox, fmtDate, money, PageHead, Spinner, Tabs, toast, useApi } from "@/components/admin/kit";
import type { AdminAccount } from "@/lib/admin-types";
import { ROLE_LABEL, TIER_LABEL, TIERS_LIST, type Tier } from "@/lib/status";

type Role = "all" | "workshop" | "marketer";
type State = "all" | "active" | "inactive";

function AccountCard({ a, onChanged }: { a: AdminAccount; onChanged: () => void }) {
  const [tier, setTier] = useState<Tier>((a.tier as Tier) || "Bronze");
  const [limit, setLimit] = useState(String(Number(a.debt_limit) || 0));
  const [busy, setBusy] = useState(false);
  const isWorkshop = a.role === "workshop";
  const dirty = isWorkshop && (tier !== ((a.tier as Tier) || "Bronze") || Number(limit) !== (Number(a.debt_limit) || 0));

  useEffect(() => {
    setTier((a.tier as Tier) || "Bronze");
    setLimit(String(Number(a.debt_limit) || 0));
  }, [a.tier, a.debt_limit]);

  async function patch(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    const r = await api(`/api/admin/accounts/${a.id}`, { method: "PATCH", body });
    setBusy(false);
    if (!r.ok) return toast(r.error, "err");
    toast(okMsg);
    onChanged();
  }

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
        {isWorkshop && <div><dt className="text-xs text-white/45">رقم الترخيص</dt><dd className="text-white">{a.license || "—"}</dd></div>}
        {isWorkshop && <div><dt className="text-xs text-white/45">الاختصاص</dt><dd className="text-white">{a.specs?.length ? a.specs.join("، ") : "—"}</dd></div>}
        {isWorkshop && <div><dt className="text-xs text-white/45">أُحيلت بواسطة</dt><dd className="text-white">{a.referred_by_code ? `${a.referred_by_name ?? "—"} (${a.referred_by_code})` : "—"}</dd></div>}
        {!isWorkshop && <div><dt className="text-xs text-white/45">كود الإحالة</dt><dd className="text-white" dir="ltr" style={{ textAlign: "right" }}>{a.my_ref_code || "—"}</dd></div>}
        {isWorkshop && <div><dt className="text-xs text-white/45">الدين الحالي</dt><dd className={Number(a.debt_balance) > 0 ? "font-semibold text-[#FF9F0A]" : "text-white"}>{money(a.debt_balance)}</dd></div>}
      </dl>

      {isWorkshop && (
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/30 p-3">
          <label className="space-y-1 text-xs text-white/65">
            الفئة
            <select className="inp" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
              {TIERS_LIST.map((t) => <option key={t} value={t}>{TIER_LABEL[t]} ({t})</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-white/65">
            سقف الدين ($)
            <input className="inp" type="number" min={0} step="1" inputMode="decimal" dir="ltr" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </label>
          <button type="button" disabled={!dirty || busy} className="btn col-span-2" onClick={() => patch({ tier, debt_limit: Number(limit) }, "تم حفظ الفئة وسقف الدين")}>
            <Save size={15} />حفظ الفئة والسقف
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {a.is_active ? (
          <button type="button" disabled={busy} className="inline-flex items-center gap-1.5 rounded-full border border-[#FF453A]/40 bg-[#FF453A]/10 px-4 py-2 text-sm font-semibold text-[#FF6961] hover:bg-[#FF453A]/20" onClick={() => { if (confirm(`تعليق حساب «${a.name}»؟ لن يتمكن من تسجيل الدخول.`)) patch({ is_active: false }, "تم تعليق الحساب"); }}>
            <Pause size={15} />تعليق الحساب
          </button>
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
      <PageHead title="الشركات والورشات" sub="التحقق من التسجيلات، تفعيل أو تعليق الحسابات، وضبط سقف الدين والفئة" />
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
