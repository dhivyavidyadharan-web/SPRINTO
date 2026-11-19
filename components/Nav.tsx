"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { LayoutDashboard, Play, KanbanSquare, MessagesSquare, AlertTriangle, Snowflake, Sparkles, Scale, Settings, LogOut, ShieldCheck } from "lucide-react";

type Counts = { inputNeeded: number; cold: number; feedback: number };

const ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/run", label: "Run", icon: Play },
  { href: "/board", label: "Pipeline board", icon: KanbanSquare },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/cold", label: "Cold deals", icon: Snowflake, count: "cold" as const },
  { href: "/input-needed", label: "Input needed", icon: AlertTriangle, count: "inputNeeded" as const },
  { href: "/feedback", label: "Feedback loop", icon: Sparkles, count: "feedback" as const },
  { href: "/rubric", label: "Rubric", icon: Scale },
  { href: "/settings", label: "Settings", icon: Settings },
];

const BADGE: Record<keyof Counts, string> = {
  inputNeeded: "bg-amber-400 text-brand-900",
  cold: "bg-sky-300/90 text-brand-900",
  feedback: "bg-blush-400 text-white",
};

export function Nav({ counts, passwordGate }: { counts: Counts; passwordGate: boolean }) {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <aside className="grad-plum sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-hidden text-white md:flex">
      <div className="pointer-events-none absolute -left-16 top-1/3 h-56 w-56 animate-floaty rounded-full bg-blush-500/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 right-0 h-40 w-40 animate-floaty rounded-full bg-zest-300/10 blur-3xl [animation-delay:-6s]" />
      <div className="relative flex items-center gap-3 px-5 py-6">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-zest-300 text-brand-900 shadow-lg shadow-black/20">
          <ShieldCheck size={20} strokeWidth={2.4} />
        </div>
        <div>
          <div className="text-[15px] font-semibold leading-tight tracking-tight">sprinto <span className="text-zest-300">outbound</span></div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/60">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping2 rounded-full bg-zest-300" /><span className="relative inline-flex h-2 w-2 rounded-full bg-zest-300" /></span>
            Autonomous agent · live test
          </div>
        </div>
      </div>
      <nav className="relative flex-1 space-y-1 px-3">
        {ITEMS.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          const Icon = it.icon;
          const n = it.count ? counts[it.count] : 0;
          return (
            <Link key={it.href} href={it.href}
              className={clsx("group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200",
                active ? "bg-white text-brand-800 shadow-lg shadow-black/15" : "text-white/75 hover:translate-x-0.5 hover:bg-white/10 hover:text-white")}>
              <Icon size={17} className={clsx("transition-transform duration-300 group-hover:scale-110", active && "text-blush-500")} />
              <span className="flex-1 font-medium">{it.label}</span>
              {it.count && n > 0 && <span className={clsx("min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-bold leading-5", BADGE[it.count])}>{n}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="relative m-3 rounded-2xl bg-white/10 p-3 text-xs text-white/70 backdrop-blur">
        <div className="font-semibold text-white">Live test mode</div>
        Every email goes only to your own inbox, with the intended recipient in the footer.
      </div>
      {passwordGate && (
        <button className="relative mx-3 mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/60 hover:bg-white/10 hover:text-white" onClick={async () => { await fetch("/api/logout", { method: "POST" }); location.href = "/login"; }}>
          <LogOut size={16} /> Log out
        </button>
      )}
    </aside>
  );
}

export function MobileNav({ counts }: { counts: Counts }) {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <div className="grad-plum sticky top-0 z-20 flex gap-1.5 overflow-x-auto px-3 py-2 md:hidden">
      {ITEMS.map((it) => {
        const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
        const n = it.count ? counts[it.count] : 0;
        return (
          <Link key={it.href} href={it.href} className={clsx("whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium", active ? "bg-white text-brand-800" : "text-white/80")}>
            {it.label}{n > 0 ? ` · ${n}` : ""}
          </Link>
        );
      })}
    </div>
  );
}
