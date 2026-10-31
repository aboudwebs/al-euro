"use client";
import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Search, Wallet } from "lucide-react";
import { api, Badge, Empty, ErrorBox, fmtDateTime, money, PageHead, Spinner, Stat, toast, useApi } from "@/components/admin/kit";
import type { LedgerEntry, Workshop } from "@/lib/admin-types";
import { LEDGER_TX_LABEL } from "@/lib/status";

export default function LedgerPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const params = new URLSearchParams();
  if (selected) params.set("workshop", selected);
  if (dq) params.set("q", dq);
  const { data, error, loading, reload } = useApi<{ workshops: Workshop[]; entries: LedgerEntry[] }>(`/api/admin/ledger?${params}`);
  const workshops = data?.workshops ?? [];
  const entries = data?.entries ?? [];
  const current = workshops.find((w) => w.id === selected) ?? null;

  const totalDebt = workshops.reduce((s, w) => s + (Number(w.debt_balance) || 0), 0);
  const indebted = workshops.filter((w) => Number(w.debt_balance) > 0).length;

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAmount(""); setNote(""); }, [selected]);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!current || busy) return;
    const value = Number(amount);
    if (!(value > 0)) return toast("أدخل مبلغاً صالحاً", "err");
    if (!confirm(`تسجيل تسديد ${money(value)} من «${current.name}»؟`)) return;
    setBusy(true);
    const r = await api<{ result?: { balance_after: number; released_commissions: number } }>("/api/admin/ledger", { method: "POST", body: { workshop_id: current.id, amount: value, note } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "err");
    const rel = r.data?.result?.released_commissions ?? 0;
    toast(`تم تسجيل التسديد. الرصيد الجديد ${money(r.data?.result?.balance_after)}${rel ? ` · أُفرج عن ${rel} عمولة` : ""}`);
    setAmount(""); setNote("");
    reload();
  }

  return (
    <>
      <PageHead title="دفتر ديون الورشات" sub="الأرصدة، سقوف الدين، وتسجيل التسديدات">
        <button type="button" className="btn2" onClick={reload}><RefreshCw size={15} />تحديث</button>
      </PageHead>

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="إجمالي الديون المستحقة" value={money(totalDebt)} tone={totalDebt > 0 ? "err" : undefined} />
        <Stat label="ورشات عليها دين" value={indebted} sub={`من أصل ${workshops.length}`} />
        <Stat label="إجمالي سقوف الدين" value={money(workshops.reduce((s, w) => s + (Number(w.debt_limit) || 0), 0))} />
      </section>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}

      {data && (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-2">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-white/45" />
              <input className="inp pe-9" placeholder="بحث عن ورشة" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {!workshops.length && <Empty>لا توجد ورشات.</Empty>}
            <ul className="space-y-2">
              {workshops.map((w) => {
                const bal = Number(w.debt_balance) || 0;
                const lim = Number(w.debt_limit) || 0;
                const pct = lim > 0 ? Math.min(100, Math.round((bal / lim) * 100)) : bal > 0 ? 100 : 0;
                const on = selected === w.id;
                return (
                  <li key={w.id}>
                    <button type="button" onClick={() => setSelected(on ? null : w.id)} aria-pressed={on} className={`card block w-full text-start transition-all ${on ? "!border-[#0A84FF]" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-white">{w.name}</span>
                        <b className={bal > 0 ? "text-[#FF9F0A]" : "text-[#30D158]"}>{money(bal)}</b>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-white/50">
                        <span>{w.city || "—"}{w.is_active ? "" : " · غير مفعّل"}</span>
                        <span>السقف {money(lim)}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40"><div className={`h-full rounded-full ${pct >= 90 ? "bg-[#FF453A]" : pct >= 70 ? "bg-[#FF9F0A]" : "bg-[#0A84FF]"}`} style={{ width: `${pct}%` }} /></div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="space-y-4 lg:col-span-3">
            {current ? (
              <form onSubmit={pay} className="card space-y-3">
                <h2 className="flex items-center gap-2 font-semibold text-white"><Wallet size={18} className="text-gold" />تسجيل تسديد من «{current.name}»</h2>
                <p className="text-sm text-white/65">الدين الحالي: <b className="text-white">{money(current.debt_balance)}</b>. عند التسديد تتحول العمولات المعلّقة المرتبطة بهذه الورشة إلى «مستحقة».</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="space-y-1 text-xs text-white/65">المبلغ ($)
                    <input className="inp" type="number" min={0.01} max={Number(current.debt_balance) || undefined} step="0.01" inputMode="decimal" dir="ltr" required value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </label>
                  <label className="space-y-1 text-xs text-white/65 sm:col-span-2">ملاحظة (اختياري)
                    <input className="inp" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: دفعة نقدية بتاريخ ..." />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className="btn" disabled={busy || !(Number(current.debt_balance) > 0)}>تسجيل التسديد</button>
                  <button type="button" className="btn2" onClick={() => setAmount(String(Number(current.debt_balance) || 0))} disabled={!(Number(current.debt_balance) > 0)}>تسديد كامل الدين</button>
                </div>
              </form>
            ) : (
              <p className="card text-sm text-white/60">اختر ورشة من القائمة لتسجيل تسديد وعرض سجلها فقط. الجدول أدناه يعرض آخر القيود لكل الورشات.</p>
            )}

            <div className="card !p-0">
              <h2 className="border-b border-white/10 px-4 py-3 font-semibold text-white">{current ? `سجل ${current.name}` : "آخر القيود"}</h2>
              {!entries.length ? (
                <p className="py-8 text-center text-sm text-white/55">لا توجد قيود بعد.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead><tr className="border-b border-white/10 text-xs text-white/45"><th className="px-4 py-2 text-start font-normal">التاريخ</th>{!current && <th className="px-2 text-start font-normal">الورشة</th>}<th className="px-2 text-start font-normal">النوع</th><th className="px-2 text-start font-normal">المبلغ</th><th className="px-2 text-start font-normal">الرصيد بعد</th><th className="px-4 text-start font-normal">ملاحظة</th></tr></thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id} className="border-b border-white/[0.07] last:border-0">
                          <td className="px-4 py-2.5 text-white/70">{fmtDateTime(e.created_at)}</td>
                          {!current && <td className="px-2 text-white">{e.workshop_name ?? "—"}</td>}
                          <td className="px-2">
                            <Badge tone={e.tx_type === "payment" ? "ok" : "warn"}>
                              {e.tx_type === "payment" ? <ArrowDownLeft size={12} className="me-1" /> : <ArrowUpRight size={12} className="me-1" />}{LEDGER_TX_LABEL[e.tx_type]}
                            </Badge>
                          </td>
                          <td className={`px-2 font-semibold ${e.tx_type === "payment" ? "text-[#30D158]" : "text-[#FF9F0A]"}`}>{e.tx_type === "payment" ? "−" : "+"}{money(e.amount)}</td>
                          <td className="px-2 text-white">{money(e.balance_after)}</td>
                          <td className="px-4 text-white/65">{e.order_number ? `طلب #${e.order_number} ` : ""}{e.note ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
