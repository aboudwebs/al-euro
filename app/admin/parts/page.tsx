"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ImagePlus, Pencil, Plus, Save, Search } from "lucide-react";
import { Toggle } from "@/components/ui";
import { BRANDS } from "@/lib/data";
import { LOW_STOCK_THRESHOLD } from "@/lib/status";
import { api, Badge, Empty, ErrorBox, Lightbox, Modal, PageHead, Spinner, Thumb, toast, useApi } from "@/components/admin/kit";
import type { AdminPart } from "@/lib/admin-types";

type Form = { name: string; brand: string; model: string; years: string; oem_number: string; alt_grade: string; price: string; stock: string; branch: string; image_url: string; is_active: boolean; category: string };

const blank = (branch = ""): Form => ({ name: "", brand: "", model: "", years: "", oem_number: "", alt_grade: "", price: "", stock: "0", branch, image_url: "", is_active: true, category: "" });
const toForm = (p: AdminPart): Form => ({
  name: p.name, brand: p.brand, model: p.model ?? "", years: p.years ?? "", oem_number: p.oem_number, alt_grade: p.alt_grade ?? "",
  price: String(Number(p.price)), stock: String(p.stock), branch: p.branch ?? "", image_url: p.image_url ?? "", is_active: p.is_active, category: p.category ?? "",
});

function PartModal({ part, branches, categories, onClose, onSaved }: { part: AdminPart | "new" | null; branches: string[]; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>(blank());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (part) setF(part === "new" ? blank(branches[0] ?? "") : toForm(part)); }, [part, branches]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const img = e.target.files?.[0];
    e.target.value = "";
    if (!img) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", img);
      const res = await fetch("/api/admin/parts/upload", { method: "POST", body: fd, credentials: "same-origin" });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.url) return toast(d?.error || "تعذر رفع الصورة", "err");
      set("image_url", d.url);
      toast("تم رفع الصورة. احفظ القطعة لتثبيتها.");
    } catch {
      toast("تعذر رفع الصورة", "err");
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!part || busy) return;
    setBusy(true);
    const body = {
      name: f.name, brand: f.brand, model: f.model, years: f.years, oem_number: f.oem_number,
      alt_grade: f.alt_grade.trim() || null, price: Number(f.price), stock: Number(f.stock), branch: f.branch,
      image_url: f.image_url.trim() || null, is_active: f.is_active,
      // Sent only when it changed, so saving a part keeps working before supabase/updates_2026_10.sql adds the column.
      ...(f.category.trim() !== (part === "new" ? "" : part.category ?? "") ? { category: f.category.trim() || null } : {}),
    };
    const r = part === "new"
      ? await api("/api/admin/parts", { method: "POST", body })
      : await api(`/api/admin/parts/${part.id}`, { method: "PATCH", body });
    setBusy(false);
    if (!r.ok) return toast(r.error, "err");
    toast(part === "new" ? "تمت إضافة القطعة" : "تم حفظ القطعة");
    onSaved();
    onClose();
  }

  const brandList = Array.from(new Set([...BRANDS, ...(f.brand ? [] : [])]));

  return (
    <Modal open={!!part} onClose={onClose} wide title={part === "new" ? "قطعة جديدة" : "تعديل القطعة"}
      footer={<><button type="button" className="btn2" onClick={onClose} disabled={busy}>إلغاء</button><button type="submit" form="part-form" className="btn" disabled={busy || uploading}><Save size={15} />{busy ? "جارٍ الحفظ..." : "حفظ"}</button></>}>
      <form id="part-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-white/65 sm:col-span-2">اسم القطعة *
          <input className="inp" required maxLength={120} value={f.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-white/65">الماركة *
          <input className="inp" required list="brand-list" maxLength={60} value={f.brand} onChange={(e) => set("brand", e.target.value)} />
          <datalist id="brand-list">{brandList.map((b) => <option key={b} value={b} />)}</datalist>
        </label>
        <label className="space-y-1 text-xs text-white/65">رقم القطعة (OEM) *
          <input className="inp" required dir="ltr" maxLength={64} value={f.oem_number} onChange={(e) => set("oem_number", e.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-white/65">الموديل
          <input className="inp" maxLength={120} value={f.model} onChange={(e) => set("model", e.target.value)} placeholder="مثال: C200 W205" />
        </label>
        <label className="space-y-1 text-xs text-white/65">سنوات الصنع
          <input className="inp" maxLength={60} value={f.years} onChange={(e) => set("years", e.target.value)} placeholder="مثال: 2015-2020" />
        </label>
        <label className="space-y-1 text-xs text-white/65">السعر ($) *
          <input className="inp" required type="number" min={0} step="0.01" inputMode="decimal" dir="ltr" value={f.price} onChange={(e) => set("price", e.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-white/65">الكمية في المخزون *
          <input className="inp" required type="number" min={0} step="1" inputMode="numeric" dir="ltr" value={f.stock} onChange={(e) => set("stock", e.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-white/65">الفرع *
          <input className="inp" required list="branch-list" maxLength={80} value={f.branch} onChange={(e) => set("branch", e.target.value)} />
          <datalist id="branch-list">{branches.map((b) => <option key={b} value={b} />)}</datalist>
        </label>
        <label className="space-y-1 text-xs text-white/65">درجة البديل (اختياري)
          <input className="inp" maxLength={60} value={f.alt_grade} onChange={(e) => set("alt_grade", e.target.value)} placeholder="مثال: OEM / Aftermarket" />
        </label>
        <label className="space-y-1 text-xs text-white/65 sm:col-span-2">القسم (اختياري)
          <input className="inp" list="category-list" maxLength={60} value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="مثال: فرامل، محرك، كهرباء" />
          <datalist id="category-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <span className="block text-[11px] text-white/40">يظهر القسم في التطبيق ويُفتح بالنقر عليه ليعرض قطعه فقط. اكتب الاسم نفسه لكل قطع القسم.</span>
        </label>
        <div className="space-y-2 sm:col-span-2">
          <span className="text-xs text-white/65">صورة القطعة</span>
          <div className="flex items-center gap-3">
            <Thumb src={f.image_url || null} alt="صورة القطعة" onOpen={() => undefined} className="h-20 w-20" />
            <div className="min-w-0 flex-1 space-y-2">
              <input className="inp" dir="ltr" placeholder="https://... رابط الصورة" value={f.image_url} onChange={(e) => set("image_url", e.target.value)} />
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={upload} />
              <button type="button" className="btn2 !py-1.5" disabled={uploading} onClick={() => file.current?.click()}><ImagePlus size={15} />{uploading ? "جارٍ الرفع..." : "رفع صورة (حتى 5MB)"}</button>
            </div>
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm text-white sm:col-span-2">
          <Toggle on={f.is_active} set={(v) => set("is_active", v)} /> ظاهرة في الكتالوج للعملاء
        </label>
      </form>
    </Modal>
  );
}

function PartRow({ p, onEdit, onChanged, onZoom }: { p: AdminPart; onEdit: () => void; onChanged: () => void; onZoom: (s: string) => void }) {
  const [price, setPrice] = useState(String(Number(p.price)));
  const [stock, setStock] = useState(String(p.stock));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPrice(String(Number(p.price))); setStock(String(p.stock)); }, [p.price, p.stock]);
  const dirty = Number(price) !== Number(p.price) || Number(stock) !== p.stock;

  async function patch(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    const r = await api(`/api/admin/parts/${p.id}`, { method: "PATCH", body });
    setBusy(false);
    if (!r.ok) return toast(r.error, "err");
    toast(msg);
    onChanged();
  }

  return (
    <tr className={`border-b border-white/[0.07] last:border-0 ${p.is_active ? "" : "opacity-60"}`}>
      <td className="px-4 py-2.5"><Thumb src={p.image_url} alt={p.name} onOpen={onZoom} className="h-12 w-12" /></td>
      <td className="px-2"><span className="font-medium text-white">{p.name}</span><small className="block text-white/50">{[p.brand, p.model, p.years].filter(Boolean).join(" · ")}</small></td>
      <td className="px-2 text-white/80" dir="ltr" style={{ textAlign: "right" }}>{p.oem_number}</td>
      <td className="px-2">
        <input aria-label="السعر" className="inp !w-24 !py-1.5" type="number" min={0} step="0.01" dir="ltr" value={price} onChange={(e) => setPrice(e.target.value)} />
      </td>
      <td className="px-2">
        <div className="flex items-center gap-1.5">
          <input aria-label="الكمية" className="inp !w-20 !py-1.5" type="number" min={0} step="1" dir="ltr" value={stock} onChange={(e) => setStock(e.target.value)} />
          {p.stock <= 0 ? <Badge tone="err">نفد</Badge> : p.stock <= LOW_STOCK_THRESHOLD ? <Badge tone="warn">منخفض</Badge> : null}
        </div>
      </td>
      <td className="px-2 text-white/80">{p.branch || "—"}</td>
      <td className="px-2"><Toggle on={p.is_active} set={(v) => { if (!busy) patch({ is_active: v }, v ? "القطعة ظاهرة الآن للعملاء" : "تم إخفاء القطعة"); }} /></td>
      <td className="px-4 text-end">
        <div className="inline-flex gap-1.5">
          {dirty && <button type="button" className="btn !py-1.5" disabled={busy} onClick={() => patch({ price: Number(price), stock: Number(stock) }, "تم تحديث السعر والكمية")}><Save size={14} />حفظ</button>}
          <button type="button" className="btn2 !py-1.5" onClick={onEdit} aria-label={`تعديل ${p.name}`}><Pencil size={14} /></button>
        </div>
      </td>
    </tr>
  );
}

function PartsInner() {
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [branch, setBranch] = useState("");
  const [active, setActive] = useState("");
  const [low, setLow] = useState(sp.get("low") === "1");
  const [edit, setEdit] = useState<AdminPart | "new" | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const params = new URLSearchParams();
  if (dq) params.set("q", dq);
  if (branch) params.set("branch", branch);
  if (active) params.set("active", active);
  if (low) params.set("low", "1");
  const { data, error, loading, reload } = useApi<{ parts: AdminPart[]; branches: string[]; categories?: string[] }>(`/api/admin/parts?${params}`);
  const list = data?.parts ?? [];
  const branches = data?.branches ?? [];
  const categories = data?.categories ?? [];

  return (
    <>
      <PageHead title="قطع الغيار والمخزون" sub="إضافة وتعديل القطع وتحديث السعر والكمية والفرع والصورة">
        <button type="button" className="btn" onClick={() => setEdit("new")}><Plus size={16} />قطعة جديدة</button>
      </PageHead>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2">
          <Search size={16} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-white/45" />
          <input className="inp pe-9" placeholder="بحث بالاسم أو الماركة أو رقم القطعة" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="inp" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="الفرع">
          <option value="">كل الفروع</option>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className="inp" value={active} onChange={(e) => setActive(e.target.value)} aria-label="الظهور">
          <option value="">ظاهرة ومخفية</option>
          <option value="1">ظاهرة فقط</option>
          <option value="0">مخفية فقط</option>
        </select>
        <label className="flex items-center gap-2 rounded-2xl border border-white/10 px-3 text-sm text-white/80">
          <input type="checkbox" className="h-4 w-4 accent-[#0A84FF]" checked={low} onChange={(e) => setLow(e.target.checked)} /> مخزون منخفض (≤ {LOW_STOCK_THRESHOLD})
        </label>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}
      {data && !list.length && <Empty>لا توجد قطع مطابقة.</Empty>}

      {list.length > 0 && (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b border-white/10 text-xs text-white/45"><th className="w-16 px-4 py-3" /><th className="px-2 text-start font-normal">القطعة</th><th className="px-2 text-start font-normal">OEM</th><th className="px-2 text-start font-normal">السعر ($)</th><th className="px-2 text-start font-normal">المخزون</th><th className="px-2 text-start font-normal">الفرع</th><th className="px-2 text-start font-normal">ظاهرة</th><th className="px-4" /></tr></thead>
            <tbody>{list.map((p) => <PartRow key={p.id} p={p} onEdit={() => setEdit(p)} onChanged={reload} onZoom={setZoom} />)}</tbody>
          </table>
        </div>
      )}
      <PartModal part={edit} branches={branches} categories={categories} onClose={() => setEdit(null)} onSaved={reload} />
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </>
  );
}

export default function PartsPage() {
  return <Suspense fallback={<Spinner />}><PartsInner /></Suspense>;
}
