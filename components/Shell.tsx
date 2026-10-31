"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Store,
  ShoppingCart,
  PackageSearch,
  Wrench,
  Share2,
  Sun,
  Moon,
  UserCheck,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useCart } from "./cart";

type NavItem = readonly [href: string, label: string, Icon: LucideIcon];

const NAV_START: NavItem[] = [
  ["/", "الكتالوج", Store],
  ["/cart", "السلة", ShoppingCart],
  ["/special", "طلب خاص", PackageSearch],
];
const NAV_ACCOUNT: NavItem = ["/account", "حسابي", UserCheck];

export default function Shell({
  children,
}: {
  children: React.ReactNode;
}) {
  const p = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { count } = useCart();

  const [user, setUser] = useState<{
    id: string;
    role: "workshop" | "marketer" | "admin";
    name: string;
    phone: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // The admin dashboard has its own layout and its own access control (middleware + admin guard).
    if (p.startsWith("/admin")) {
      setLoading(false);
      return;
    }

    fetch("/api/auth", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        const currentUser = d?.user || null;
        setUser(currentUser);
        setLoading(false);

        if (!currentUser && p !== "/login") {
          router.replace("/login");
        } else if (currentUser && p === "/login") {
          router.replace("/account");
        }
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setLoading(false);
        if (p !== "/login") {
          router.replace("/login");
        }
      });

    return () => {
      active = false;
    };
  }, [p, router]);

  const roleItem: NavItem[] =
    user?.role === "workshop"
      ? [["/workshop", "الورشة", Wrench]]
      : user?.role === "marketer"
      ? [["/marketer", "المسوّق والعميل", Share2]]
      : user?.role === "admin"
      ? [["/admin", "لوحة الإدارة", ShieldCheck]]
      : [];
  const nav: NavItem[] = [...NAV_START, ...roleItem, NAV_ACCOUNT];

  if (p.startsWith("/admin")) return <>{children}</>;

  if (loading) {
    return (
      <div className="app-canvas flex min-h-screen flex-col items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#0A84FF] border-t-transparent" />
        <p className="mt-3 text-xs text-white/60">جاري تحميل اليورو...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-canvas relative min-h-screen overflow-x-clip">
        <div className="pointer-events-none fixed inset-0 z-0">
          <div className="ambient-orb absolute -top-24 -right-24 h-80 w-80 rounded-full bg-[#0A84FF]/15 blur-[110px]" />
          <div className="ambient-orb absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-[#5E5CE6]/15 blur-[120px]" />
        </div>
        <main className="relative z-10 min-h-screen p-4">{children}</main>
      </div>
    );
  }

  return (
    <div className="app-canvas relative min-h-screen overflow-x-clip md:flex">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="ambient-orb absolute -top-24 -right-24 h-80 w-80 rounded-full bg-[#0A84FF]/15 blur-[110px]" />
        <div className="ambient-orb absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-[#5E5CE6]/15 blur-[120px]" />
      </div>

      <aside className="glass-bar fixed inset-x-0 bottom-0 z-40 flex border-t md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:flex-col md:gap-1 md:border-e md:border-t-0 md:p-4">
        <div className="hidden pb-6 pt-2 md:block">
          <span className="text-3xl font-semibold tracking-tight text-white">
            اليورو
          </span>
          <p className="text-xs text-white/45">
            قطع غيار ألمانية وأوروبية
          </p>
        </div>

        {nav.map(([h, l, I]) => {
          const a =
            p === h ||
            (h !== "/" && p.startsWith(h + "/")) ||
            (h === "/" && p.startsWith("/product/"));

          return (
            <Link
              key={h}
              href={h}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px] transition-all duration-300 active:scale-[0.97] md:flex-none md:flex-row md:gap-3 md:rounded-xl md:border md:px-3 md:text-sm ${
                a
                  ? "font-semibold text-[#0A84FF] md:border-white/[0.22] md:bg-white/[0.15] md:text-white md:backdrop-blur-md md:shadow-[0_4px_12px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.3)]"
                  : "text-white/60 hover:text-white md:border-transparent md:hover:bg-white/[0.05]"
              }`}
            >
              <I size={20} />
              {l}

              {h === "/cart" && count > 0 && (
                <b className="absolute end-1/4 top-1 rounded-full bg-gradient-to-b from-[#3A9BFD] to-[#007AFF] px-1.5 text-[10px] font-semibold text-snow shadow-[0_2px_10px_rgba(0,122,255,0.45),inset_0_1px_1px_rgba(255,255,255,0.45)] md:static md:ms-auto">
                  {count}
                </b>
              )}
            </Link>
          );
        })}
      </aside>

      <main className="relative z-10 min-w-0 flex-1 p-4 pb-24 md:p-8">
        <div className="glass-bar sticky top-0 z-40 -mx-4 -mt-4 mb-4 flex items-center justify-between gap-2 border-b px-4 py-3 md:-mx-8 md:-mt-8 md:px-8">
          <span className="text-2xl font-semibold tracking-tight text-white md:invisible">
            اليورو
          </span>

          <div className="ms-auto flex items-center gap-2">
            <Link
              href="/account"
              className="flex items-center gap-1.5 rounded-full border border-white/[0.16] bg-white/[0.08] px-3.5 py-2 text-xs font-medium text-white backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-all hover:bg-white/[0.14] active:scale-[0.97]"
            >
              <UserCheck size={15} className="text-[#0A84FF]" />
              <span className="max-w-[42vw] truncate sm:max-w-none">
                {user.name} ({user.role === "workshop" ? "ورشة" : "عميل/مسوّق"})
              </span>
            </Link>

            <button
              aria-label="تبديل الوضع"
              onClick={() =>
                setTheme(theme === "dark" ? "light" : "dark")
              }
              className="flex items-center justify-center rounded-full border border-white/[0.16] bg-white/[0.08] p-2.5 text-white backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-all hover:bg-white/[0.14] active:scale-[0.97]"
            >
              <Sun className="hidden dark:block" size={18} />
              <Moon className="dark:hidden" size={18} />
            </button>
          </div>
        </div>

        {children}
      </main>
    </div>
  );
}
