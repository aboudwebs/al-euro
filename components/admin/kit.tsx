"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";

/* ------------------------------------------------------------------ fetch helpers */

export type ApiResult<T> = { ok: boolean; status: number; data: T | null; error: string };

export async function api<T = Record<string, unknown>>(url: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 401) {
      window.location.href = "/admin/login";
      return { ok: false, status: 401, data: null, error: "انتهت الجلسة" };
    }
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) return { ok: false, status: res.status, data: null, error: data?.error || "تعذر تنفيذ الطلب" };
    return { ok: true, status: res.status, data, error: "" };
  } catch {
    return { ok: false, status: 0, data: null, error: "تعذر الاتصال بالخادم" };
  }
}

export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (!url) return;
      const id = ++seq.current;
      if (!silent) setLoading(true);
      const r = await api<T>(url);
      if (id !== seq.current) return;
      if (r.ok) { setData(r.data); setError(""); } else setError(r.error);
      setLoading(false);
    },
    [url]
  );

  useEffect(() => { load(); }, [load]);
  const reload = useCallback(() => load(true), [load]);
  return { data, error, loading, reload };
}

/* ------------------------------------------------------------------ formatting */

export const money = (n: number | string | null | undefined) =>
  "$" + (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB") : "—");
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—";

/* ------------------------------------------------------------------ toast */

export function toast(message: string, kind: "ok" | "err" = "ok") {
  window.dispatchEvent(new CustomEvent("admin-toast", { detail: { message, kind } }));
}

export function Toaster() {
  const [items, setItems] = useState<{ id: number; message: string; kind: "ok" | "err" }[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ message: string; kind: "ok" | "err" }>).detail;
      const id = ++n;
      setItems((s) => [...s, { id, ...d }]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), d.kind === "err" ? 6000 : 3500);
    };
    window.addEventListener("admin-toast", on);
    return () => window.removeEventListener("admin-toast", on);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[200] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "err" ? "alert" : "status"}
          className={`menu-surface pointer-events-auto max-w-md rounded-2xl px-4 py-3 text-sm font-medium shadow-xl ${t.kind === "err" ? "border-[#FF453A]/50 text-[#FF6961]" : "border-[#30D158]/40 text-[#30D158]"}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ small UI */

export type Tone = "ok" | "warn" | "err" | "info" | "mute" | "gold";
const TONES: Record<Tone, string> = {
  ok: "bg-[#30D158]/15 text-[#30D158]",
  warn: "bg-[#FF9F0A]/15 text-[#FF9F0A]",
  err: "bg-[#FF453A]/15 text-[#FF453A]",
  info: "bg-[#0A84FF]/15 text-[#0A84FF]",
  mute: "bg-white/[0.08] text-white/65",
  gold: "bg-gold/15 text-gold",
};

export function Badge({ tone = "mute", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>;
}

export const ORDER_TONE: Record<string, Tone> = { pending: "warn", approved: "info", shipped: "info", delivered: "ok", cancelled: "err" };
export const SPECIAL_TONE: Record<string, Tone> = { new: "warn", priced: "info", ordered: "info", completed: "ok", cancelled: "err" };
export const COMMISSION_TONE: Record<string, Tone> = { held: "warn", available: "ok", paid: "mute" };

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {sub && <p className="text-sm text-white/65">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, href }: { label: string; value: React.ReactNode; sub?: string; tone?: Tone; href?: string }) {
  const color = tone === "warn" ? "text-[#FF9F0A]" : tone === "err" ? "text-[#FF453A]" : tone === "ok" ? "text-[#30D158]" : tone === "gold" ? "text-gold" : "text-white";
  const body = (
    <>
      <p className="text-sm text-white/65">{label}</p>
      <b className={`mt-1 block text-2xl font-semibold tracking-tight ${color}`}>{value}</b>
      {sub && <p className="mt-1 text-xs text-white/45">{sub}</p>}
    </>
  );
  const cls = "card block transition-all duration-300";
  return href ? <a href={href} className={`${cls} hover:-translate-y-0.5`}>{body}</a> : <div className={cls}>{body}</div>;
}

export function Spinner({ label = "جارٍ التحميل..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/65">
      <Loader2 size={18} className="animate-spin text-[#0A84FF]" /> {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#FF453A]/40 bg-[#FF453A]/15 p-3 text-sm text-[#FF6961]">
      <span className="flex items-center gap-2"><AlertTriangle size={16} /> {message}</span>
      {onRetry && <button type="button" onClick={onRetry} className="btn2 py-1.5">إعادة المحاولة</button>}
    </div>
  );
}

export function Empty({ children = "لا توجد بيانات" }: { children?: React.ReactNode }) {
  return <div className="card py-10 text-center text-sm text-white/55">{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-1" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          type="button"
          onClick={() => onChange(it.value)}
          className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm transition-all ${
            value === it.value ? "border-white/[0.22] bg-white/[0.15] font-semibold text-white" : "border-transparent text-white/60 hover:text-white"
          }`}
        >
          {it.label}
          {typeof it.count === "number" && it.count > 0 && <b className="rounded-full bg-[#0A84FF] px-1.5 text-[10px] text-snow">{it.count}</b>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ overlays */

function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [active, onClose]);
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`menu-surface flex max-h-full w-full flex-col rounded-3xl text-white shadow-2xl ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button type="button" aria-label="إغلاق" onClick={onClose} className="rounded-full p-1.5 text-white/65 hover:text-white"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] bg-black/55 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="menu-surface absolute inset-y-0 end-0 flex w-full max-w-xl flex-col text-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button type="button" aria-label="إغلاق" onClick={onClose} className="rounded-full p-1.5 text-white/65 hover:text-white"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

/** Full-screen image viewer: wheel / buttons to zoom, drag to pan, Esc to close. */
export function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEscape(!!src, onClose);
  useEffect(() => { setZoom(1); setPos({ x: 0, y: 0 }); }, [src]);
  if (!src) return null;

  const clamp = (z: number) => Math.min(6, Math.max(1, Math.round(z * 100) / 100));
  const change = (z: number) => { const next = clamp(z); setZoom(next); if (next === 1) setPos({ x: 0, y: 0 }); };

  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label="معاينة الإيصال">
      <div className="flex items-center justify-between gap-2 p-3 text-snow">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="تكبير" className="rounded-full bg-white/15 p-2.5 hover:bg-white/25" onClick={() => change(zoom + 0.5)}><ZoomIn size={18} /></button>
          <button type="button" aria-label="تصغير" className="rounded-full bg-white/15 p-2.5 hover:bg-white/25" onClick={() => change(zoom - 0.5)}><ZoomOut size={18} /></button>
          <button type="button" aria-label="إعادة الضبط" className="rounded-full bg-white/15 p-2.5 hover:bg-white/25" onClick={() => change(1)}><RotateCcw size={18} /></button>
          <span className="px-2 text-sm tabular-nums">{Math.round(zoom * 100)}%</span>
        </div>
        <div className="flex items-center gap-1">
          <a href={src} target="_blank" rel="noreferrer" className="rounded-full bg-white/15 p-2.5 hover:bg-white/25" aria-label="فتح في تبويب جديد"><ExternalLink size={18} /></a>
          <button type="button" aria-label="إغلاق" className="rounded-full bg-white/15 p-2.5 hover:bg-white/25" onClick={onClose}><X size={18} /></button>
        </div>
      </div>
      <div
        className="relative flex-1 touch-none overflow-hidden"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        onWheel={(e) => change(zoom + (e.deltaY < 0 ? 0.25 : -0.25))}
        onPointerDown={(e) => { if (zoom > 1) { drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } }}
        onPointerMove={(e) => { const d = drag.current; if (d) setPos({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }); }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => change(zoom > 1 ? 1 : 2.5)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="صورة مكبّرة"
          draggable={false}
          className={`absolute inset-0 m-auto max-h-full max-w-full select-none object-contain ${zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`, transition: drag.current ? "none" : "transform 0.15s" }}
        />
      </div>
      <p className="p-2 text-center text-xs text-white/60">عجلة الفأرة أو الأزرار للتكبير · اسحب للتحريك · نقر مزدوج للتبديل</p>
    </div>
  );
}

export function Thumb({ src, alt, onOpen, className = "h-24 w-24" }: { src: string | null | undefined; alt: string; onOpen: (src: string) => void; className?: string }) {
  if (!src) return <div className={`${className} grid shrink-0 place-items-center rounded-2xl border border-dashed border-white/20 text-xs text-white/40`}>لا صورة</div>;
  return (
    <button type="button" onClick={() => onOpen(src)} className={`${className} group relative shrink-0 overflow-hidden rounded-2xl border border-white/15`} aria-label={`تكبير: ${alt}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
      <span className="absolute inset-0 hidden place-items-center bg-black/40 text-snow group-hover:grid"><ZoomIn size={20} /></span>
    </button>
  );
}

/** Confirmation dialog, optionally with a required text field (used for rejection / cancellation reasons). */
export function ConfirmModal({
  open, title, message, confirmLabel, danger, reasonLabel, reasonRequired, busy, onConfirm, onClose,
}: {
  open: boolean; title: string; message?: React.ReactNode; confirmLabel: string; danger?: boolean;
  reasonLabel?: string; reasonRequired?: boolean; busy?: boolean; onConfirm: (reason: string) => void; onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  const blocked = busy || (!!reasonLabel && !!reasonRequired && reason.trim().length < 3);
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn2" disabled={busy} onClick={onClose}>تراجع</button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => onConfirm(reason.trim())}
            className={danger ? "inline-flex items-center justify-center gap-2 rounded-full bg-[#FF453A] px-4 py-2.5 text-sm font-semibold text-snow disabled:opacity-50" : "btn"}
          >
            {busy && <Loader2 size={15} className="animate-spin" />}{confirmLabel}
          </button>
        </>
      }
    >
      {message && <div className="mb-3 text-sm leading-relaxed text-white/80">{message}</div>}
      {reasonLabel && (
        <label className="block space-y-2 text-sm text-white/65">
          {reasonLabel}
          <textarea className="inp min-h-[88px]" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </label>
      )}
    </Modal>
  );
}
