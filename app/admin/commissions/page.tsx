"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, Badge, COMMISSION_TONE, Empty, ErrorBox, fmtDate, money, PageHead, Spinner, Stat, Tabs, toast, useApi } from "@/components/admin/kit";
import type { AdminCommission } from "@/lib/admin-types";
import { COMMISSION_STATUS_LABEL, COMMISSION_RATE, type CommissionStatus } from "@/lib/status";

type Filter = "all" | CommissionStatus;

export default function CommissionsPage() {
  const [filter, setFilter] = useState<Filter>("available");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useApi<{ commissions: AdminCommission[]; totals: Record<CommissionStatus, number> }>(`/api/admin/commissions${filter === "all" ? "" : `?status=${filter}`}`);
  const list = data?.commissions ?? [];
  const availableIds = list.filter((c) => c.status === "available").map((c) => c.id);
  const sel = picked.filter((id) => availableIds.includes(id));
  const selSum = list.filter((c) => sel.includes(c.id)).reduce((s, c) => s + Number(c.commission_amount), 0);

  async function pay(ids: string[]) {
    if (!ids.length || busy) return;
    const sum = list.filter((c) => ids.includes(c.id)).reduce((s, c) => s + Number(c.commission_amount), 0);
    if (!confirm(`تأكيد دفع ${ids.length} عمولة بإجمالي ${money(sum)}؟`)) return;
    setBusy(true);
    const r = await api("/api/admin/commissions", { method: "POST", body: { ids } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "err");
    toast("تم تحويل العمولات إلى «مدفوعة»");
    setPicked([]);
    reload();
  }

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <>
      <PageHead title="عمولات المسوّقين" sub={`عمولة ${COMMISSION_RATE * 100}% على الطلبات المُسلَّمة للورشات المُحالة. المعلّقة تُفرَج عند تسديد دين الورشة.`}>
        <button type="button" className="btn2" onClick={reload}><RefreshCw size={15} />تحديث</button>
      </PageHead>

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="معلّقة (حتى تسديد الدين)" value={money(data?.totals.held)} tone="warn" />
        <Stat label="مستحقة الدفع" value={money(data?.totals.available)} tone="ok" />
        <Stat label="مدفوعة" value={money(data?.totals.paid)} />
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Tabs<Filter> value={filter} onChange={(f) => { setFilter(f); setPicked([]); }} items={[
          { value: "available", label: "مستحقة" }, { value: "held", label: "معلّقة" }, { value: "paid", label: "مدفوعة" }, { value: "all", label: "الكل" },
        ]} />
        {!!availableIds.length && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn2" onClick={() => setPicked(sel.length === availableIds.length ? [] : availableIds)}>{sel.length === availableIds.length ? "إلغاء التحديد" : "تحديد كل المستحقة"}</button>
            <button type="button" className="btn" disabled={!sel.length || busy} onClick={() => pay(sel)}>دفع المحدد ({sel.length}) · {money(selSum)}</button>
          </div>
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && !list.length && <Empty>لا توجد عمولات في هذا التصنيف.</Empty>}

      {list.length > 0 && (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[680px] text-sm">
            <thead><tr className="border-b border-white/10 text-xs text-white/45"><th className="w-10 px-4 py-3" /><th className="px-2 text-start font-normal">المسوّق</th><th className="px-2 text-start font-normal">الورشة</th><th className="px-2 text-start font-normal">الطلب</th><th className="px-2 text-start font-normal">مبلغ الطلب</th><th className="px-2 text-start font-normal">العمولة</th><th className="px-2 text-start font-normal">الحالة</th><th className="px-2 text-start font-normal">التاريخ</th><th className="px-4" /></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-b border-white/[0.07] last:border-0">
                  <td className="px-4 py-3">{c.status === "available" && <input type="checkbox" className="h-4 w-4 accent-[#0A84FF]" aria-label={`تحديد عمولة ${c.marketer_name}`} checked={sel.includes(c.id)} onChange={() => toggle(c.id)} />}</td>
                  <td className="px-2 font-medium text-white">{c.marketer_name}</td>
                  <td className="px-2 text-white/80">{c.workshop_name}</td>
                  <td className="px-2 text-white/80">{c.order_number ? `#${c.order_number}` : "—"}</td>
                  <td className="px-2 text-white/80">{money(c.order_amount)}</td>
                  <td className="px-2 font-semibold text-gold">{money(c.commission_amount)}</td>
                  <td className="px-2"><Badge tone={COMMISSION_TONE[c.status]}>{COMMISSION_STATUS_LABEL[c.status]}</Badge></td>
                  <td className="px-2 text-white/60">{fmtDate(c.created_at)}</td>
                  <td className="px-4 text-end">{c.status === "available" && <button type="button" className="btn !py-1.5" disabled={busy} onClick={() => pay([c.id])}>تم الدفع</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
