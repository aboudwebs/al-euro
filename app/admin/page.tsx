"use client";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Badge, Empty, ErrorBox, money, PageHead, Spinner, Stat, useApi } from "@/components/admin/kit";
import type { Overview } from "@/lib/admin-types";

export default function AdminOverview() {
  const { data, error, loading, reload } = useApi<{ overview: Overview }>("/api/admin/overview");
  const o = data?.overview;

  const totalStock = o ? o.branches.reduce((s, b) => s + Number(b.total_stock), 0) : 0;
  const totalValue = o ? o.branches.reduce((s, b) => s + Number(b.stock_value), 0) : 0;

  return (
    <>
      <PageHead title="نظرة عامة" sub="مؤشرات الأداء وتحليلات الفروع والمخزون">
        <button type="button" className="btn2" onClick={reload}><RefreshCw size={15} />تحديث</button>
      </PageHead>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !o && <Spinner />}

      {o && (
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="المؤشرات">
            <Stat label="الإيرادات (طلبات معتمدة)" value={money(o.revenue_total)} sub={`آخر 30 يوماً: ${money(o.revenue_30d)}`} tone="gold" />
            <Stat label="طلبات قيد المراجعة" value={o.pending_orders} tone={o.pending_orders ? "warn" : undefined} href="/admin/orders?status=pending" sub="بانتظار الموافقة" />
            <Stat label="إيصالات شام كاش بانتظار التحقق" value={o.pending_sham} tone={o.pending_sham ? "warn" : undefined} href="/admin/payments" sub="تحتاج مراجعة فورية" />
            <Stat label="حسابات بانتظار التفعيل" value={o.pending_activations} tone={o.pending_activations ? "warn" : undefined} href="/admin/accounts?status=inactive" sub="ورشات ومسوّقون" />
            <Stat label="إجمالي ديون الورشات" value={money(o.total_debt)} tone={o.total_debt > 0 ? "err" : undefined} href="/admin/ledger" sub="الرصيد المستحق حالياً" />
            <Stat label="طلبات خاصة جديدة" value={o.new_requests} tone={o.new_requests ? "warn" : undefined} href="/admin/requests" sub="بانتظار التسعير" />
            <Stat label="عمولات مستحقة الدفع" value={money(o.available_commissions)} tone="ok" href="/admin/commissions" sub="جاهزة للتحويل للمسوّقين" />
            <Stat label="عمولات معلّقة" value={money(o.held_commissions)} href="/admin/commissions" sub="حتى تسديد دين الورشة" />
          </section>

          <section className="grid gap-4 lg:grid-cols-5">
            <div className="card lg:col-span-3">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold text-white">المخزون حسب الفرع</h2>
                <span className="text-xs text-white/55">{totalStock.toLocaleString("en-US")} قطعة · قيمة {money(totalValue)}</span>
              </div>
              {!o.branches.length ? (
                <p className="py-6 text-center text-sm text-white/55">لا توجد قطع فعّالة.</p>
              ) : (
                <div className="space-y-3">
                  {o.branches.map((b) => {
                    const pct = totalStock ? Math.round((Number(b.total_stock) / totalStock) * 100) : 0;
                    return (
                      <div key={b.branch}>
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="font-medium text-white">{b.branch}</span>
                          <span className="flex items-center gap-2 text-xs text-white/65">
                            {b.low_count > 0 && <Badge tone="warn">{b.low_count} منخفض</Badge>}
                            {b.parts_count} صنف · {Number(b.total_stock).toLocaleString("en-US")} قطعة · {money(b.stock_value)}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-black/40" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`حصة ${b.branch} من المخزون`}>
                          <div className="h-full rounded-full bg-gradient-to-l from-[#3A9BFD] to-[#007AFF]" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card lg:col-span-2">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold text-white"><AlertTriangle size={17} className="text-[#FF9F0A]" />تنبيهات المخزون المنخفض</h2>
                <span className="text-xs text-white/55">الحد: ≤ {o.low_stock_threshold}</span>
              </div>
              {!o.low_stock.length ? (
                <p className="py-6 text-center text-sm text-[#30D158]">كل الأصناف ضمن الحد الآمن.</p>
              ) : (
                <ul className="max-h-[360px] divide-y divide-white/10 overflow-y-auto">
                  {o.low_stock.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate text-white">{p.name}</span>
                        <small className="text-white/50">{p.brand} · {p.branch}</small>
                      </span>
                      <Badge tone={p.stock <= 0 ? "err" : "warn"}>{p.stock <= 0 ? "نفد" : `متبقي ${p.stock}`}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/admin/parts?low=1" className="btn2 mt-3 w-full">إدارة المخزون</Link>
            </div>
          </section>
        </div>
      )}
      {!loading && !error && !o && <Empty />}
    </>
  );
}
