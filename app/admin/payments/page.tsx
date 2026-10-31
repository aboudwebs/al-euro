"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import OrderActions from "@/components/admin/OrderActions";
import { Badge, Empty, ErrorBox, fmtDateTime, Lightbox, money, ORDER_TONE, PageHead, Spinner, Tabs, Thumb, useApi } from "@/components/admin/kit";
import type { AccountInfo, AdminOrder } from "@/lib/admin-types";
import { ORDER_STATUS_LABEL, ROLE_LABEL } from "@/lib/status";

type Payment = AdminOrder & { account: AccountInfo | null };
type Filter = "pending" | "approved" | "cancelled" | "all";

export default function PaymentsPage() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [zoom, setZoom] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<{ payments: Payment[] }>(`/api/admin/payments?status=${filter}`);
  const list = data?.payments ?? [];

  return (
    <>
      <PageHead title="مركز التحقق من دفعات شام كاش" sub="راجع الإيصال وقارنه بالمبلغ، ثم وافق على الطلب أو ارفضه مع ذكر السبب">
        <button type="button" className="btn2" onClick={reload}><RefreshCw size={15} />تحديث</button>
      </PageHead>

      <div className="mb-4">
        <Tabs<Filter> value={filter} onChange={setFilter} items={[
          { value: "pending", label: "بانتظار التحقق" },
          { value: "approved", label: "تمت الموافقة" },
          { value: "cancelled", label: "مرفوضة" },
          { value: "all", label: "الكل" },
        ]} />
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && !list.length && <Empty>{filter === "pending" ? "لا توجد إيصالات بانتظار التحقق 🎉" : "لا توجد دفعات في هذا التصنيف."}</Empty>}

      <div className="grid gap-4 xl:grid-cols-2">
        {list.map((p) => {
          const acc = p.account;
          return (
            <article key={p.id} className="card space-y-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-white">طلب #{p.order_number ?? "—"}</h3>
                  <p className="text-xs text-white/55">{fmtDateTime(p.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={ORDER_TONE[p.status]}>{ORDER_STATUS_LABEL[p.status]}</Badge>
                  <b className="text-xl font-semibold text-gold">{money(p.total_amount)}</b>
                </div>
              </header>

              <div className="flex gap-3">
                <Thumb src={p.receipt_signed_url} alt={`إيصال الطلب ${p.order_number ?? ""}`} onOpen={setZoom} className="h-32 w-28" />
                <dl className="min-w-0 flex-1 space-y-1 text-sm">
                  <div><dt className="inline text-white/45">العميل: </dt><dd className="inline font-medium text-white">{p.customer_name}</dd></div>
                  <div><dt className="inline text-white/45">الهاتف: </dt><dd className="inline text-white" dir="ltr">{p.customer_phone}</dd></div>
                  <div><dt className="inline text-white/45">الحساب: </dt><dd className="inline text-white">{ROLE_LABEL[p.user_role]}{acc?.city ? ` · ${acc.city}` : ""}</dd></div>
                  {acc?.license && <div><dt className="inline text-white/45">الترخيص: </dt><dd className="inline text-white">{acc.license}</dd></div>}
                  {!p.receipt_signed_url && <p className="text-xs text-[#FF9F0A]">لا يوجد إيصال مرفق</p>}
                </dl>
              </div>

              <table className="w-full text-sm">
                <thead><tr className="border-b border-white/10 text-xs text-white/45"><th className="py-1.5 text-start font-normal">القطعة</th><th className="font-normal">الكمية</th><th className="text-end font-normal">المجموع</th></tr></thead>
                <tbody>
                  {(p.items ?? []).map((it, i) => (
                    <tr key={i} className="border-b border-white/[0.07] last:border-0">
                      <td className="py-1.5 text-white">{it.name}<small className="block text-white/45">{[it.brand, it.oem_number].filter(Boolean).join(" · ")}</small></td>
                      <td className="text-center text-white/80">{it.qty} × {money(it.unit_price)}</td>
                      <td className="text-end text-white">{money(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {p.status === "cancelled" && p.status_note && <p className="rounded-xl bg-[#FF453A]/10 p-2.5 text-sm text-[#FF8A80]">سبب الرفض: {p.status_note}</p>}
              <OrderActions order={p} onDone={reload} approveLabel="اعتماد الدفعة والموافقة" cancelLabel="رفض الإيصال" />
            </article>
          );
        })}
      </div>
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </>
  );
}
