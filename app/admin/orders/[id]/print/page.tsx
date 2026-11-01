"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, Printer } from "lucide-react";
import { ErrorBox, fmtDateTime, money, Spinner, useApi } from "@/components/admin/kit";
import type { AccountInfo, AdminOrder } from "@/lib/admin-types";
import { ORDER_STATUS_LABEL, PAY_METHOD_LABEL, ROLE_LABEL } from "@/lib/status";

type Detail = { order: AdminOrder; customer: AccountInfo | null };
type Mode = "invoice" | "packing";
function invoiceMoney(value: number, order: AdminOrder): string {
  const rate = Number(order.invoice_exchange_rate);
  if (order.invoice_currency === "SYP" && Number.isFinite(rate) && rate > 0) {
    return `${Math.round(value * rate).toLocaleString("en-US")} ل.س`;
  }
  return money(value);
}
function invoiceTotal(order: AdminOrder): string {
  if (order.invoice_currency === "SYP" && order.invoice_total_syp != null) {
    return `${Math.round(Number(order.invoice_total_syp)).toLocaleString("en-US")} ل.س`;
  }
  return money(order.total_amount);
}
function invoiceCashback(order: AdminOrder): string {
  if (order.invoice_currency === "SYP" && order.invoice_cashback_used_syp != null) {
    return `${Math.round(Number(order.invoice_cashback_used_syp)).toLocaleString("en-US")} ل.س`;
  }
  return money(order.cashback_used ?? 0);
}
function invoiceDue(order: AdminOrder): string {
  if (order.invoice_currency === "SYP" && order.invoice_amount_due_syp != null) {
    return `${Math.round(Number(order.invoice_amount_due_syp)).toLocaleString("en-US")} ل.س`;
  }
  return money(order.amount_due ?? order.total_amount - (order.cashback_used ?? 0));
}



export default function PrintOrder() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading } = useApi<Detail>(id ? `/api/admin/orders/${id}` : null);
  const [mode, setMode] = useState<Mode>("invoice");
  const o = data?.order;
  const c = data?.customer;

  return (
    <div className="app-canvas min-h-screen min-w-0 p-2 sm:p-4 md:p-8">
      <div className="no-print mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-2">
        <Link href="/admin/orders" className="btn2"><ArrowRight size={16} />رجوع للطلبات</Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-white/15 bg-black/30 p-1 text-sm">
            {(["invoice", "packing"] as Mode[]).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-full px-4 py-1.5 ${mode === m ? "bg-white/[0.15] font-semibold text-white" : "text-white/60"}`}>
                {m === "invoice" ? "فاتورة" : "قائمة تجهيز"}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => window.print()} disabled={!o}><Printer size={16} />طباعة</button>
        </div>
      </div>

      {error && <div className="no-print mx-auto max-w-3xl"><ErrorBox message={error} /></div>}
      {loading && !o && <div className="no-print"><Spinner /></div>}

      {o && (
        <article className="invoice-sheet mx-auto w-full min-w-0 max-w-3xl" dir="rtl">
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, borderBottom: "2px solid #0f172a", paddingBottom: 14, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>اليورو</div>
              <div className="muted" style={{ fontSize: 12 }}>قطع غيار ألمانية وأوروبية</div>
            </div>
            <div style={{ textAlign: "left" }} dir="ltr">
              <div style={{ fontSize: 20, fontWeight: 800 }} dir="rtl">{mode === "invoice" ? "فاتورة" : `قائمة تجهيز #${o.order_number}`}</div>
              <div className="muted" style={{ fontSize: 12 }} dir="rtl">{fmtDateTime(o.created_at)}</div>
            </div>
          </header>

          <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18, fontSize: 13 }}>
            <div>
              <div className="muted">العميل</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{o.customer_name}</div>
              <div dir="ltr" style={{ textAlign: "right" }}>{o.customer_phone}</div>
              <div className="muted">{ROLE_LABEL[o.user_role]}{c?.city ? ` · ${c.city}` : ""}</div>
              {c?.license && <div className="muted">ترخيص: {c.license}</div>}
            </div>
            <div>
              <div className="muted">تفاصيل الطلب</div>
              <div>طريقة الدفع: <b>{PAY_METHOD_LABEL[o.pay_method]}</b></div>
              <div>الحالة: <b>{ORDER_STATUS_LABEL[o.status]}</b></div>
              {o.status === "cancelled" && o.status_note && <div>سبب الإلغاء: {o.status_note}</div>}
              {o.tracking_number && <div>رقم التتبع: <b dir="ltr">{o.tracking_number}</b></div>}
              {o.delivery_address && <div>عنوان التسليم: {[o.delivery_address.label, o.delivery_address.governorate, o.delivery_address.area, o.delivery_address.street, o.delivery_address.details].filter(Boolean).join(" - ")}</div>}
            </div>
          </section>

          <table>
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th>القطعة</th>
                <th>رقم القطعة (OEM)</th>
                <th style={{ width: 60 }}>الكمية</th>
                {mode === "invoice" && <th>سعر الوحدة</th>}
                {mode === "invoice" && <th>المجموع</th>}
                {mode === "packing" && <th style={{ width: 70 }}>تم التجهيز</th>}
              </tr>
            </thead>
            <tbody>
              {(o.items ?? []).map((it, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td><b>{it.name}</b>{it.brand ? <div className="muted" style={{ fontSize: 11 }}>{it.brand}</div> : null}</td>
                  <td dir="ltr" style={{ textAlign: "right" }}>{it.oem_number || "—"}</td>
                  <td style={{ textAlign: "center", fontWeight: 700 }}>{it.qty}</td>
                  {mode === "invoice" && <td>{invoiceMoney(it.unit_price, o)}</td>}
                  {mode === "invoice" && <td>{invoiceMoney(it.line_total, o)}</td>}
                  {mode === "packing" && <td style={{ textAlign: "center" }}>☐</td>}
                </tr>
              ))}
            </tbody>
            {mode === "invoice" && (
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ textAlign: "left", fontWeight: 700 }}>الإجمالي</td>
                  <td className="gold" style={{ fontWeight: 800, fontSize: 15 }}>{invoiceTotal(o)}</td>
                </tr>
                {(o.cashback_used ?? 0) > 0 && <tr>
                  <td colSpan={5} style={{ textAlign: "left" }}>الكاش باك المستخدم</td>
                  <td>{invoiceCashback(o)}</td>
                </tr>}
                <tr>
                  <td colSpan={5} style={{ textAlign: "left", fontWeight: 700 }}>المتبقي للدفع</td>
                  <td style={{ fontWeight: 700 }}>{invoiceDue(o)}</td>
                </tr>
              </tfoot>
            )}
          </table>

          <footer className="muted" style={{ marginTop: 28, display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span>{mode === "invoice" ? "شكراً لتعاملكم مع اليورو" : "راجع القطع قبل التغليف"}</span>
            <span>توقيع المستلم: ____________________</span>
          </footer>
        </article>
      )}
    </div>
  );
}
