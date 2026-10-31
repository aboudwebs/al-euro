"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Printer, RefreshCw, Save, Search } from "lucide-react";
import OrderActions from "@/components/admin/OrderActions";
import { api, Badge, Drawer, Empty, ErrorBox, fmtDateTime, Lightbox, money, ORDER_TONE, PageHead, Spinner, Thumb, toast, useApi } from "@/components/admin/kit";
import type { AccountInfo, AdminOrder, DeliveryAddress, LedgerEntry } from "@/lib/admin-types";
import { LEDGER_TX_LABEL, ORDER_STATUS_LABEL, ORDER_STATUSES, PAY_METHOD, PAY_METHOD_LABEL, ROLE_LABEL, COMMISSION_STATUS_LABEL, type CommissionStatus, type OrderStatus } from "@/lib/status";

type Detail = {
  order: AdminOrder;
  customer: (AccountInfo & { debt_limit: number | null; debt_balance: number | null }) | null;
  ledger: LedgerEntry[];
  commission: { id: string; commission_amount: number; status: CommissionStatus } | null;
};

const STEPS: OrderStatus[] = ["pending", "approved", "shipped", "delivered"];

function Timeline({ status }: { status: OrderStatus }) {
  if (status === "cancelled") return <Badge tone="err">ملغي</Badge>;
  const at = STEPS.indexOf(status);
  return (
    <ol className="flex items-center gap-1 text-xs" aria-label="مراحل الطلب">
      {STEPS.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col items-center gap-1">
          <span className={`h-1.5 w-full rounded-full ${i <= at ? "bg-[#0A84FF]" : "bg-white/15"}`} />
          <span className={i <= at ? "font-semibold text-white" : "text-white/45"}>{ORDER_STATUS_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  );
}

export function addressLines(a: DeliveryAddress | null | undefined): string[] {
  if (!a) return [];
  return [a.label, [a.governorate, a.area].filter(Boolean).join(" - "), a.street, a.details, a.phone && `هاتف: ${a.phone}`].filter((x): x is string => !!x);
}

/** Delivery address chosen by the customer + the tracking number the admin gives them. */
function DeliveryBox({ order, onSaved }: { order: AdminOrder; onSaved: () => void }) {
  const [tracking, setTracking] = useState(order.tracking_number ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setTracking(order.tracking_number ?? ""), [order.id, order.tracking_number]);
  const lines = addressLines(order.delivery_address);
  const canTrack = order.status !== "cancelled" && order.status !== "pending";

  async function save() {
    setBusy(true);
    const r = await api(`/api/admin/orders/${order.id}/tracking`, { method: "POST", body: { tracking } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "err");
    toast(tracking.trim() ? "تم حفظ رقم التتبع" : "تم مسح رقم التتبع");
    onSaved();
  }

  if (!lines.length && !canTrack) return null;
  return (
    <section className="space-y-2 text-sm">
      <h4 className="font-semibold text-white">التسليم</h4>
      {lines.length > 0 ? <div className="text-white/80">{lines.map((l, i) => <p key={i}>{l}</p>)}</div> : <p className="text-white/45">لم يحدّد العميل عنواناً.</p>}
      {canTrack && (
        <div className="flex items-center gap-2">
          <input className="inp !py-1.5" dir="ltr" maxLength={60} placeholder="رقم التتبع (يظهر للعميل)" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          <button type="button" className="btn !py-1.5" disabled={busy || tracking.trim() === (order.tracking_number ?? "")} onClick={save}><Save size={14} />حفظ</button>
        </div>
      )}
    </section>
  );
}

function OrderDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { data, error, loading, reload } = useApi<Detail>(id ? `/api/admin/orders/${id}` : null);
  const [zoom, setZoom] = useState<string | null>(null);
  const d = id && data?.order.id === id ? data : null; // ignore a previously opened order while the new one loads
  const o = d?.order;
  const done = () => { reload(); onChanged(); };

  return (
    <Drawer open={!!id} onClose={onClose} title={o ? `طلب #${o.order_number ?? ""}` : "تفاصيل الطلب"}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !o && <Spinner />}
      {o && d && (
        <div className="space-y-5">
          <Timeline status={o.status} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
              <Badge tone="mute">{PAY_METHOD_LABEL[o.pay_method]}</Badge>
            </div>
            <b className="text-xl text-gold">{money(o.total_amount)}</b>
          </div>
          {o.status === "cancelled" && o.status_note && <p className="rounded-xl bg-[#FF453A]/10 p-3 text-sm text-[#FF8A80]">سبب الإلغاء: {o.status_note}</p>}

          <section className="space-y-1 text-sm">
            <h4 className="font-semibold text-white">العميل</h4>
            <p className="text-white">{o.customer_name} <small className="text-white/55">({ROLE_LABEL[o.user_role]})</small></p>
            <p className="text-white/80" dir="ltr" style={{ textAlign: "right" }}>{o.customer_phone}</p>
            {d.customer && <p className="text-white/65">{[d.customer.city, d.customer.license && `ترخيص ${d.customer.license}`].filter(Boolean).join(" · ") || "—"}</p>}
            {d.customer?.role === "workshop" && <p className="text-white/65">الدين الحالي {money(d.customer.debt_balance)} من سقف {money(d.customer.debt_limit)}</p>}
            <p className="text-xs text-white/45">أُنشئ: {fmtDateTime(o.created_at)}</p>
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-white">القطع</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-white/10 text-xs text-white/45"><th className="py-1.5 text-start font-normal">القطعة</th><th className="font-normal">الكمية</th><th className="text-end font-normal">المجموع</th></tr></thead>
                <tbody>
                  {(o.items ?? []).map((it, i) => (
                    <tr key={i} className="border-b border-white/[0.07] last:border-0">
                      <td className="py-1.5 text-white">{it.name}<small className="block text-white/45">{[it.brand, it.oem_number].filter(Boolean).join(" · ")}</small></td>
                      <td className="text-center text-white/80">{it.qty} × {money(it.unit_price)}</td>
                      <td className="text-end text-white">{money(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <DeliveryBox order={o} onSaved={done} />

          {o.receipt_signed_url !== undefined && o.pay_method === PAY_METHOD.sham && (
            <section>
              <h4 className="mb-2 text-sm font-semibold text-white">إيصال شام كاش</h4>
              <Thumb src={o.receipt_signed_url} alt="إيصال" onOpen={setZoom} className="h-40 w-32" />
            </section>
          )}

          {d.ledger.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-semibold text-white">قيود دفتر الدين</h4>
              <ul className="space-y-1 text-sm">
                {d.ledger.map((l) => (
                  <li key={l.id} className="flex justify-between gap-2 text-white/80"><span>{LEDGER_TX_LABEL[l.tx_type]} · {l.note ?? ""}</span><b className="text-white">{money(l.amount)}</b></li>
                ))}
              </ul>
            </section>
          )}
          {d.commission && <p className="text-sm text-white/80">عمولة المسوّق: <b className="text-white">{money(d.commission.commission_amount)}</b> <Badge tone="mute">{COMMISSION_STATUS_LABEL[d.commission.status]}</Badge></p>}

          <div className="space-y-3 border-t border-white/10 pt-4">
            <OrderActions order={o} onDone={done} />
            <Link href={`/admin/orders/${o.id}/print`} target="_blank" className="btn2 w-full"><Printer size={16} />طباعة الفاتورة / قائمة التجهيز</Link>
          </div>
        </div>
      )}
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </Drawer>
  );
}

function OrdersInner() {
  const sp = useSearchParams();
  const initial = sp.get("status");
  const [status, setStatus] = useState<string>(initial && (ORDER_STATUSES as string[]).includes(initial) ? initial : "");
  const [pay, setPay] = useState("");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (pay) params.set("pay", pay);
  if (dq) params.set("q", dq);
  const { data, error, loading, reload } = useApi<{ orders: AdminOrder[] }>(`/api/admin/orders?${params}`);
  const list = data?.orders ?? [];

  return (
    <>
      <PageHead title="إدارة الطلبات" sub="فلترة، تفاصيل، وتحديث الحالة بنقرة واحدة">
        <button type="button" className="btn2" onClick={reload}><RefreshCw size={15} />تحديث</button>
      </PageHead>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2">
          <Search size={16} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-white/45" />
          <input className="inp pe-9" placeholder="رقم الطلب أو اسم العميل أو الهاتف" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="inp" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="الحالة">
          <option value="">كل الحالات</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}
        </select>
        <select className="inp" value={pay} onChange={(e) => setPay(e.target.value)} aria-label="طريقة الدفع">
          <option value="">كل طرق الدفع</option>
          {Object.values(PAY_METHOD).map((m) => <option key={m} value={m}>{PAY_METHOD_LABEL[m]}</option>)}
        </select>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && !list.length && <Empty>لا توجد طلبات مطابقة.</Empty>}

      {list.length > 0 && (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-white/45">
                <th className="px-4 py-3 text-start font-normal">#</th>
                <th className="px-2 text-start font-normal">العميل</th>
                <th className="px-2 text-start font-normal">التاريخ</th>
                <th className="px-2 text-start font-normal">الدفع</th>
                <th className="px-2 text-start font-normal">المبلغ</th>
                <th className="px-2 text-start font-normal">الحالة</th>
                <th className="px-4 text-end font-normal">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className="cursor-pointer border-b border-white/[0.07] last:border-0 hover:bg-white/[0.04]" onClick={() => setOpen(o.id)}>
                  <td className="px-4 py-3 font-semibold text-white">{o.order_number ?? "—"}</td>
                  <td className="px-2 text-white">{o.customer_name}<small className="block text-white/45" dir="ltr" style={{ textAlign: "right" }}>{o.customer_phone}</small></td>
                  <td className="px-2 text-white/70">{fmtDateTime(o.created_at)}</td>
                  <td className="px-2 text-white/80">{PAY_METHOD_LABEL[o.pay_method]}</td>
                  <td className="px-2 font-semibold text-white">{money(o.total_amount)}</td>
                  <td className="px-2"><Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge></td>
                  <td className="px-4 text-end" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex"><OrderActions order={o} onDone={reload} compact /></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <OrderDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />
    </>
  );
}

export default function OrdersPage() {
  return <Suspense fallback={<Spinner />}><OrdersInner /></Suspense>;
}
