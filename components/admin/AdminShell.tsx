"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { BookOpen, Banknote, Boxes, LayoutDashboard, LogOut, Moon, PackageSearch, Percent, ShoppingBag, Store, Sun, Users, type LucideIcon } from "lucide-react";
import { api, Toaster } from "./kit";
import type { Overview } from "@/lib/admin-types";

type Item = { href: string; label: string; Icon: LucideIcon; badge?: (o: Overview) => number };

const NAV: Item[] = [
  { href: "/admin", label: "نظرة عامة", Icon: LayoutDashboard },
  { href: "/admin/accounts", label: "الحسابات", Icon: Users, badge: (o) => o.pending_activations },
  { href: "/admin/payments", label: "دفعات شام كاش", Icon: Banknote, badge: (o) => o.pending_sham },
  { href: "/admin/orders", label: "الطلبات", Icon: ShoppingBag, badge: (o) => o.pending_orders },
  { href: "/admin/requests", label: "طلبات خاصة (VIN)", Icon: PackageSearch, badge: (o) => o.new_requests },
  { href: "/admin/ledger", label: "دفتر الدين", Icon: BookOpen },
  { href: "/admin/parts", label: "قطع الغيار", Icon: Boxes },
  { href: "/admin/commissions", label: "عمولات المسوّقين", Icon: Percent },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "";
  const { theme, setTheme } = useTheme();
  const [overview, setOverview] = useState<Overview | null>(null);
  const bare = path === "/admin/login" || path === "/admin/reset-password" || path.endsWith("/print");

  const refresh = useCallback(async () => {
    const r = await api<{ overview: Overview }>("/api/admin/overview");
    if (r.ok && r.data?.overview) setOverview(r.data.overview);
  }, []);

  useEffect(() => {
    if (bare) return;
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [bare, refresh, path]);

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    window.location.href = "/admin/login";
  }

  if (bare) return <>{children}<Toaster /></>;

  const active = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/"));

  const link = (it: Item, mobile: boolean) => {
    const a = active(it.href);
    const count = overview && it.badge ? it.badge(overview) : 0;
    return (
      <Link
        key={it.href}
        href={it.href}
        aria-current={a ? "page" : undefined}
        className={
          mobile
            ? `relative flex shrink-0 flex-col items-center gap-1 rounded-xl px-3 py-2 text-[11px] transition-all ${a ? "font-semibold text-[#0A84FF]" : "text-white/60"}`
            : `flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-all active:scale-[0.98] ${a ? "border-white/[0.22] bg-white/[0.15] font-semibold text-white md:bg-white/[0.15]" : "border-transparent text-white/60 hover:bg-white/[0.05] hover:text-white"}`
        }
      >
        <it.Icon size={mobile ? 20 : 18} />
        <span className={mobile ? "whitespace-nowrap" : ""}>{it.label}</span>
        {count > 0 && (
          <b className={`rounded-full bg-gradient-to-b from-[#3A9BFD] to-[#007AFF] px-1.5 text-[10px] font-semibold text-snow ${mobile ? "absolute end-1 top-0" : "ms-auto"}`}>{count}</b>
        )}
      </Link>
    );
  };

  return (
    <div className="app-canvas relative min-h-screen overflow-x-clip md:flex">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="ambient-orb absolute -top-24 -right-24 h-80 w-80 rounded-full bg-[#0A84FF]/15 blur-[110px]" />
        <div className="ambient-orb absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-gold/10 blur-[120px]" />
      </div>

      <aside className="glass-bar relative z-30 hidden w-64 shrink-0 flex-col gap-1 border-e p-4 md:sticky md:top-0 md:flex md:h-screen">
        <div className="pb-5 pt-2">
          <span className="text-3xl font-semibold tracking-tight text-white">اليورو</span>
          <p className="text-xs text-gold">لوحة الإدارة</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto" aria-label="أقسام الإدارة">{NAV.map((it) => link(it, false))}</nav>
        <Link href="/" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/60 hover:text-white"><Store size={18} />المتجر</Link>
        <button type="button" onClick={logout} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[#FF6961] hover:bg-[#FF453A]/10"><LogOut size={18} />تسجيل الخروج</button>
      </aside>

      <div className="relative z-10 min-w-0 flex-1">
        <header className="glass-bar sticky top-0 z-40 border-b">
          <div className="flex items-center justify-between gap-2 px-4 py-3 md:px-8">
            <span className="text-xl font-semibold tracking-tight text-white md:invisible">اليورو <small className="text-xs text-gold">الإدارة</small></span>
            <div className="ms-auto flex items-center gap-2">
              <Link href="/" className="btn2 md:hidden" aria-label="المتجر"><Store size={16} /></Link>
              <button
                type="button"
                aria-label="تبديل الوضع"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] p-2.5 text-white transition-all hover:bg-white/[0.14] active:scale-[0.97]"
              >
                <Sun className="hidden dark:block" size={18} />
                <Moon className="dark:hidden" size={18} />
              </button>
              <button type="button" onClick={logout} className="btn2 md:hidden" aria-label="تسجيل الخروج"><LogOut size={16} /></button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-white/10 px-2 md:hidden" aria-label="أقسام الإدارة">{NAV.map((it) => link(it, true))}</nav>
        </header>
        <main className="p-4 pb-16 md:p-8">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
