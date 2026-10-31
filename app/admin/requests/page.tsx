"use client";
import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw, Save, XCircle } from "lucide-react";
import { api, Badge, ConfirmModal, Empty, ErrorBox, fmtDateTime, Lightbox, money, PageHead, Spinner, SPECIAL_TONE, Tabs, Thumb, toast, useApi } from "@/components/admin/kit";
import type { AdminRequest } from "@/lib/admin-types";
import { SPECIAL_STATUS_LABEL, SPECIAL_STATUSES, SPECIAL_TRANSITIONS, type SpecialStatus } from "@/lib/status";

type Filter = "all" | SpecialStatus;

const NEXT_LABEL: Partial<Record<SpecialStatus, string>> = { ordered: "تم طلب القطعة من المورّد", completed: "اكتمل الطلب" };

function RequestCard({ r, onZoom, onChanged }: { r: AdminRequest; onZoom: (s: string) => void; onChanged: () => void }) {
  const [price, setPrice] = useState(r.quoted_price ? String(Number(r.quoted_price)) : "");
  const [note, setNote] = useState(r.admin_note);
  const [busy, setBusy] = useState(false);
  const [cancel, setCancel] = useState(false);
  useEffect(() => { setPrice(r.quoted_price ? String(Number(r.quoted_price)) : ""); setNote(r.admin_note); }, [r.quoted_price, r.admin_note]);

  const editable = r.status === "new" || r.status === "priced";
  const dirty = price !== (r.quoted_price ? String(Number(r.quoted_price)) : "") || note !== r.admin_note;
  const brand = r.brand === "أخرى" ? r.other_brand || "أخرى" : r.brand;

  async function patch(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    const res = await api(`/api/admin/requests/${r.id}`, { method: "PATCH", body });
    setBusy(false);
    if (!res.ok) return toast(res.error, "err");
    toast(msg);
    setCancel(false);
    onChanged();
  }

  const save = () => {
    const body: Record<string, unknown> = { note };
    if (price.trim()) body.quoted_price = Number(price);
    return patch(body, r.status === "new" && price.trim() ? "تم حفظ السعر وتحويل الطلب إلى «تم التسعير»" : "تم الحفظ");
  };

  return (
    <article className="card space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-white">{r.part_name}</h3>
          <p className="text-sm text-white/65">{brand} · {fmtDateTime(r.created_at)}</p>
        </div>
        <Badge tone={SPECIAL_TONE[r.status]}>{SPECIAL_STATUS_LABEL[r.status]}</Badge>
      </header>

      <div className="flex gap-3">
        <Thumb src={r.image_signed_url} alt={`صورة ${r.part_name}`} onOpen={onZoom} className="h-28 w-28" />
        <dl className="min-w-0 flex-1 space-y-1 text-sm">
          <div><dt className="inline text-white/45">العميل: </dt><dd className="inline text-white">{r.customer_name}</dd></div>
          <div><dt className="inline text-white/45">الهاتف: </dt><dd className="inline text-white" dir="ltr">{r.customer_phone}</dd></div>
          <div className="flex flex-wrap items-center gap-1.5">
            <dt className="text-white/45">VIN / OEM:</dt>
            <dd className="font-mono text-white" dir="ltr">{r.vin_or_oem || "—"}</dd>
            {r.vin_or_oem && (
              <button type="button" aria-label="نسخ" className="rounded-full p-1 text-white/55 hover:text-white" onClick={() => navigator.clipboard?.writeText(r.vin_or_oem!).then(() => toast("تم النسخ"), () => undefined)}><Copy size={14} /></button>
            )}
          </div>
          {r.customer_notes && <p className="rounded-xl bg-black/25 p-2 text-white/80">{r.customer_notes}</p>}
        </dl>
      </div>

      <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/25 p-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-white/65 sm:col-span-1">
          السعر المقترح ($)
          <input className="inp" type="number" min={0} step="0.01" inputMode="decimal" dir="ltr" disabled={!editable} value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-white/65 sm:col-span-2">
          ملاحظة للعميل (تظهر في حسابه)
          <textarea className="inp min-h-[42px]" maxLength={800} disabled={!editable && r.status !== "ordered"} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {(editable || r.status === "ordered") && (
          <button type="button" className="btn sm:col-span-3" disabled={busy || !dirty} onClick={save}><Save size={15} />{r.status === "new" ? "حفظ السعر والملاحظة" : "حفظ التعديلات"}</button>
        )}
        {!editable && r.quoted_price ? <p className="text-sm text-white sm:col-span-3">السعر المعتمد: <b className="text-gold">{money(r.quoted_price)}</b></p> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {(SPECIAL_TRANSITIONS[r.status] ?? []).filter((s) => s !== "cancelled" && s !== "priced").map((s) => (
          <button key={s} type="button" className="btn" disabled={busy} onClick={() => patch({ status: s }, `الحالة: ${SPECIAL_STATUS_LABEL[s]}`)}><Check size={15} />{NEXT_LABEL[s] ?? SPECIAL_STATUS_LABEL[s]}</button>
        ))}
        {r.status === "priced" && (
          <p className="self-center text-xs text-white/55">بعد موافقة العميل اضغط «تم طلب القطعة» ← ثم «اكتمل».</p>
        )}
        {SPECIAL_TRANSITIONS[r.status]?.includes("cancelled") && (
          <button type="button" disabled={busy} onClick={() => setCancel(true)} className="inline-flex items-center gap-1.5 rounded-full border border-[#FF453A]/40 bg-[#FF453A]/10 px-4 py-2 text-sm font-semibold text-[#FF6961] hover:bg-[#FF453A]/20"><XCircle size={15} />إلغاء الطلب</button>
        )}
      </div>

      <ConfirmModal open={cancel} busy={busy} danger title="إلغاء الطلب الخاص" reasonLabel="سبب الإلغاء (يظهر للعميل)" reasonRequired confirmLabel="تأكيد الإلغاء" onClose={() => setCancel(false)} onConfirm={(reason) => patch({ status: "cancelled", note: reason }, "تم إلغاء الطلب")} />
    </article>
  );
}

export default function RequestsPage() {
  const [filter, setFilter] = useState<Filter>("new");
  const [zoom, setZoom] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<{ requests: AdminRequest[] }>(`/api/admin/requests${filter === "all" ? "" : `?status=${filter}`}`);
  const list = data?.requests ?? [];

  return (
    <>
      <PageHead title="طلبات VIN / القطع الخاصة" sub="راجع طلبات العملاء، سعّرها، وتابع حالتها حتى الاكتمال">
        <button type="button" className="btn2" onClick={reload}><RefreshCw size={15} />تحديث</button>
      </PageHead>
      <div className="mb-4">
        <Tabs<Filter> value={filter} onChange={setFilter} items={[{ value: "all", label: "الكل" }, ...SPECIAL_STATUSES.map((s) => ({ value: s as Filter, label: SPECIAL_STATUS_LABEL[s] }))]} />
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && !list.length && <Empty>لا توجد طلبات في هذا التصنيف.</Empty>}
      <div className="grid gap-4 xl:grid-cols-2">
        {list.map((r) => <RequestCard key={r.id} r={r} onZoom={setZoom} onChanged={reload} />)}
      </div>
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </>
  );
}
