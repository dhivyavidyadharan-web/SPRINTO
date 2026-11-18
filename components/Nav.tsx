"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { LayoutDashboard, Play, KanbanSquare, MessagesSquare, AlertTriangle, ThumbsUp, Scale, Settings, LogOut } from "lucide-react";

const ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/run", label: "Run", icon: Play },
  { href: "/board", label: "Pipeline board", icon: KanbanSquare },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/input-needed", label: "Input needed", icon: AlertTriangle },
  { href: "/feedback", label: "Feedback & rules", icon: ThumbsUp },
  { href: "/rubric", label: "Rubric", icon: Scale },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav({ inputNeeded }: { inputNeeded: number }) {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-700 text-sm font-bold text-white">S</div>
        <div>
          <div className="text-sm font-semibold text-slate-900">Sprinto Outbound</div>
          <div className="text-[11px] text-slate-500">Autonomous agent · live test</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {ITEMS.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          const Icon = it.icon;
          return (
            <Link key={it.href} href={it.href} className={clsx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm", active ? "bg-brand-50 font-semibold text-brand-800" : "text-slate-600 hover:bg-slate-50")}>
              <Icon size={16} />
              <span className="flex-1">{it.label}</span>
              {it.href === "/input-needed" && inputNeeded > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{inputNeeded}</span>}
            </Link>
          );
        })}
      </nav>
      <button className="m-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50" onClick={async () => { await fetch("/api/logout", { method: "POST" }); location.href = "/login"; }}>
        <LogOut size={16} /> Log out
      </button>
    </aside>
  );
}

export function MobileNav() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 md:hidden">
      {ITEMS.map((it) => <Link key={it.href} href={it.href} className={clsx("whitespace-nowrap rounded-md px-2 py-1 text-xs", path === it.href ? "bg-brand-50 font-semibold text-brand-800" : "text-slate-600")}>{it.label}</Link>)}
    </div>
  );
}
