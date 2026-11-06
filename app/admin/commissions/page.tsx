"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, Badge, COMMISSION_TONE, Empty, ErrorBox, fmtDate, money, PageHead, Spinner, Stat, Tabs, toast, useApi } from "@/components/admin/kit";
import type { AdminCommission } from "@/lib/admin-types";
import { COMMISSION_STATUS_LABEL, COMMISSION_RATE, type CommissionStatus } from "@/lib/status";

type Filter = "all" | CommissionStatus;

export default function CommissionsPage() {
  const [filter, setFilter] = useState<Filter>("available");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<{ commissions: AdminCommission[]; totals: Record<CommissionStatus, number> }>(`/api/admin/commissions${filter === "all" ? "" : `?status=${filter}`}`);
  const list = data?.commissions ?? [];
  return (
    <>
      <PageHead title="عمولات المسوّقين" sub={`عمولة ${COMMISSION_RATE * 100}% على الطلبات المُسلَّمة للورشات المُحالة. المعلّقة تُفرَج عند تسديد دين الورشة. لا تُسجّل أي عمولة كمدفوعة إلا بعد إرسال المسوّق طلب سحب ومراجعته من قسم طلبات السحب.`}>
        <button type="button" className="btn2" onClick={reload}><RefreshCw size={15} />تحديث</button>
      </PageHead>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="معلّقة (حتى تسديد الدين)" value={money(data?.totals.held)} tone="warn" />
        <Stat label="مستحقة الدفع" value={money(data?.totals.available)} tone="ok" />
        <Stat label="محجوزة بطلب تحويل" value={money(data?.totals.payout_requested)} tone="warn" />
        <Stat label="مدفوعة" value={money(data?.totals.paid)} />
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Tabs<Filter> value={filter} onChange={(f) => { setFilter(f); }} items={[
          { value: "available", label: "مستحقة" }, { value: "held", label: "معلّقة" }, { value: "payout_requested", label: "بطلب تحويل" }, { value: "paid", label: "مدفوعة" }, { value: "all", label: "الكل" },
        ]} />

      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && !list.length && <Empty>لا توجد عمولات في هذا التصنيف.</Empty>}

      {list.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {list.map((c) => {
            const isOpen = expanded === c.id;
            return (
              <article key={c.id} className="min-w-0 rounded-2xl border border-white/10 bg-[#111a25] p-4 shadow-sm">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-white">{c.marketer_name}</p>
                    <p className="mt-1 break-words text-xs text-white/50">{c.workshop_name}</p>
                  </div>
                  <Badge tone={COMMISSION_TONE[c.status]}>{COMMISSION_STATUS_LABEL[c.status]}</Badge>
                </div>
                <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs text-white/50">قيمة العمولة</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-gold">{money(c.commission_amount)}</p>
                  </div>
                  <button type="button" className="btn2 !px-3 !py-2 text-xs" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : c.id)}>
                    {isOpen ? "إخفاء التفاصيل" : "عرض التفاصيل"}
                  </button>
                </div>
                {isOpen && (
                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/10 pt-3 text-sm">
                    <div className="min-w-0"><p className="text-xs text-white/45">المسوّق</p><p className="mt-1 break-words text-white">{c.marketer_name}</p></div>
                    <div className="min-w-0"><p className="text-xs text-white/45">الورشة</p><p className="mt-1 break-words text-white">{c.workshop_name}</p></div>
                    <div><p className="text-xs text-white/45">رقم الطلب</p><p className="mt-1 text-white">{c.order_number ? `#${c.order_number}` : "—"}</p></div>
                    <div><p className="text-xs text-white/45">مبلغ الطلب</p><p className="mt-1 text-white">{money(c.order_amount)}</p></div>
                    <div><p className="text-xs text-white/45">تاريخ تسجيل العمولة</p><p className="mt-1 text-white/80">{fmtDate(c.created_at)}</p></div>
                    <div><p className="text-xs text-white/45">الحالة</p><div className="mt-1"><Badge tone={COMMISSION_TONE[c.status]}>{COMMISSION_STATUS_LABEL[c.status]}</Badge></div></div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
