"use client";
import { useEffect, useState } from "react";
import { PackageCheck, PackageSearch } from "lucide-react";
import { usd } from "@/lib/data";
import {
  ORDER_STATUS_LABEL, PAY_METHOD_LABEL, SPECIAL_STATUS_LABEL,
  type OrderStatus, type PayMethod, type SpecialStatus,
} from "@/lib/status";

type MyOrder = { id: string; order_number: number | null; total_amount: number; pay_method: PayMethod; status: OrderStatus; status_note: string | null; created_at: string };
type MyRequest = { id: string; part_name: string; brand: string; other_brand: string | null; quoted_price: number | null; status: SpecialStatus; admin_note: string; created_at: string };

const tone = (s: string) =>
  s === "cancelled" ? "text-[#FF453A]" : s === "delivered" || s === "completed" ? "text-[#30D158]" : s === "pending" || s === "new" ? "text-[#FF9F0A]" : "text-[#0A84FF]";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB");

/** Customer-side view of their orders and special requests (shows the admin's rejection reason / quote). */
export default function MyActivity() {
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [requests, setRequests] = useState<MyRequest[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/orders", { cache: "no-store" }).then((r) => r.json()).then((d) => alive && setOrders(Array.isArray(d?.orders) ? d.orders : [])).catch(() => alive && setOrders([]));
    fetch("/api/special-requests", { cache: "no-store" }).then((r) => r.json()).then((d) => alive && setRequests(Array.isArray(d?.requests) ? d.requests : [])).catch(() => alive && setRequests([]));
    return () => { alive = false; };
  }, []);

  if (!orders?.length && !requests?.length) return null;

  return (
    <section className="space-y-3">
      {!!orders?.length && (
        <div className="card space-y-1">
          <h3 className="mb-1 flex items-center gap-2 font-semibold text-white"><PackageCheck size={18} className="text-[#0A84FF]" />طلباتي</h3>
          {orders.map((o) => (
            <div key={o.id} className="border-b border-white/[0.10] py-2 text-sm last:border-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-white">طلب #{o.order_number ?? "—"} <small className="text-white/45">· {day(o.created_at)} · {PAY_METHOD_LABEL[o.pay_method] ?? o.pay_method}</small></span>
                <b className="text-white">{usd(Number(o.total_amount))}</b>
              </div>
              <p className={`text-xs font-semibold ${tone(o.status)}`}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</p>
              {o.status === "cancelled" && o.status_note && (
                <p className="mt-1 rounded-xl bg-[#FF453A]/10 p-2 text-xs text-[#FF8A80]">السبب: {o.status_note}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {!!requests?.length && (
        <div className="card space-y-1">
          <h3 className="mb-1 flex items-center gap-2 font-semibold text-white"><PackageSearch size={18} className="text-[#0A84FF]" />طلباتي الخاصة</h3>
          {requests.map((r) => (
            <div key={r.id} className="border-b border-white/[0.10] py-2 text-sm last:border-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-white">{r.part_name} <small className="text-white/45">· {r.brand === "أخرى" ? r.other_brand || r.brand : r.brand} · {day(r.created_at)}</small></span>
                {r.quoted_price ? <b className="text-white">{usd(Number(r.quoted_price))}</b> : null}
              </div>
              <p className={`text-xs font-semibold ${tone(r.status)}`}>{SPECIAL_STATUS_LABEL[r.status] ?? r.status}</p>
              {r.admin_note && <p className="mt-1 rounded-xl bg-[#0A84FF]/10 p-2 text-xs text-white/80">ملاحظة الإدارة: {r.admin_note}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
