"use client";

export function Toggle({
  on,
  set,
}: {
  on: boolean;
  set: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => set(!on)}
      className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]/50 active:scale-[0.97] ${
        on
          ? "bg-[#30D158] ring-1 ring-white/[0.25] shadow-[0_0_14px_rgba(48,209,88,0.35),inset_0_1px_0_rgba(255,255,255,0.35)]"
          : "bg-white/[0.12] backdrop-blur-xl ring-1 ring-white/[0.14] shadow-[inset_0_2px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)]"
      }`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-snow shadow-[0_2px_6px_rgba(0,0,0,0.4)] transition-all duration-300 ${
          on ? "-translate-x-5" : ""
        }`}
      />
    </button>
  );
}

export const H = ({ t, s }: { t: string; s?: string }) => (
  <div className="mb-5">
    <h1 className="text-2xl font-semibold tracking-tight text-white">{t}</h1>
    {s && <p className="text-sm text-white/65">{s}</p>}
  </div>
);

export const Row = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <div className="flex items-center justify-between gap-3 border-b border-white/[0.10] py-2 text-sm text-white transition-all last:border-0">
    {children}
  </div>
);
