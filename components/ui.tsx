import type { ReactNode, CSSProperties } from "react";
import { clsx } from "clsx";
import { CountUp } from "./motion";

/** Card with optional staggered entrance (`delay` in ms) and hover lift. */
export function Card({ title, children, className, right, delay, hover, icon }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode; delay?: number; hover?: boolean; icon?: ReactNode }) {
  const style: CSSProperties | undefined = delay !== undefined ? { animationDelay: `${delay}ms` } : undefined;
  return (
    <section className={clsx("card reveal", hover && "card-hover", className)} style={style}>
      {title && <div className="card-h"><span className="flex items-center gap-2">{icon}{title}</span>{right}</div>}
      <div className="card-b">{children}</div>
    </section>
  );
}

const STATUS_COLORS: Record<string, string> = {
  QUEUED: "bg-cream-200 text-ink-700",
  PROCESSING: "bg-lavender-200 text-brand-800",
  QUALIFIED: "bg-zest-200 text-brand-900",
  EMAILED: "bg-zest-200 text-brand-900",
  FOLLOWUP_1_SENT: "bg-blush-100 text-blush-700",
  FOLLOWUP_2_SENT: "bg-blush-200 text-blush-700",
  IN_CONVERSATION: "bg-lavender-200 text-brand-800",
  MEETING_BOOKED: "bg-brand-700 text-white",
  INPUT_NEEDED: "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
  BACKUP: "bg-sky-100 text-sky-800",
  NURTURE: "bg-lime-100 text-lime-800",
  DISQUALIFIED: "bg-rose-100 text-rose-800",
  UNREACHABLE: "bg-zinc-200 text-zinc-700",
  DO_NOT_CONTACT: "bg-ink-900 text-white",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide", STATUS_COLORS[status] ?? "bg-cream-200 text-ink-700")}>{status.replace(/_/g, " ")}</span>;
}

type Tone = "slate" | "green" | "red" | "amber" | "blue" | "pink" | "plum" | "zest" | "sky";
const TONES: Record<Tone, string> = {
  slate: "bg-cream-200 text-ink-700", green: "bg-emerald-100 text-emerald-800", red: "bg-rose-100 text-rose-800", amber: "bg-amber-100 text-amber-900",
  blue: "bg-lavender-200 text-brand-800", pink: "bg-blush-100 text-blush-700", plum: "bg-brand-700 text-white", zest: "bg-zest-200 text-brand-900", sky: "bg-sky-100 text-sky-800",
};
export function Pill({ children, tone = "slate", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", TONES[tone], className)}>{children}</span>;
}

export function GateStatus({ status }: { status: string }) {
  return <Pill tone={status === "pass" ? "green" : status === "fail" ? "red" : "amber"}>{status}</Pill>;
}

/** Metric tile: icon chip, animated number, hint. Add new tiles on the Overview by appending to its list. */
export function Stat({ label, value, hint, icon, tone = "plum", delay = 0, prefix, decimals, href }: { label: string; value: number; hint?: string; icon?: ReactNode; tone?: "plum" | "pink" | "zest" | "lavender" | "amber" | "sky"; delay?: number; prefix?: string; decimals?: number; href?: string }) {
  const chip = {
    plum: "bg-gradient-to-br from-brand-600 to-brand-800 text-white",
    pink: "bg-gradient-to-br from-blush-400 to-blush-600 text-white",
    zest: "bg-zest-300 text-brand-900",
    lavender: "bg-lavender-200 text-brand-800",
    amber: "bg-amber-100 text-amber-800",
    sky: "bg-sky-100 text-sky-800",
  }[tone];
  const inner = (
    <div className="card card-hover reveal group relative overflow-hidden px-4 py-4" style={{ animationDelay: `${delay}ms` }}>
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-blush-100/60 blur-2xl transition-opacity duration-500 group-hover:opacity-100 md:opacity-0" />
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{label}</div>
        {icon && <div className={clsx("grid h-8 w-8 place-items-center rounded-xl shadow-soft transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6", chip)}>{icon}</div>}
      </div>
      <div className="mt-2 text-[28px] font-semibold leading-none text-brand-900"><CountUp value={value} prefix={prefix} decimals={decimals} /></div>
      {hint && <div className="mt-1.5 text-xs text-ink-500">{hint}</div>}
    </div>
  );
  return href ? <a href={href} className="block">{inner}</a> : inner;
}

export function SourceLink({ url }: { url?: string | null }) {
  if (!url) return <span className="text-ink-500/60">—</span>;
  let label = url;
  try { const u = new URL(url); label = u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, ""); } catch { /* keep */ }
  return <a href={url} target="_blank" rel="noreferrer" className="break-all text-xs text-blush-600 underline decoration-dotted underline-offset-2 hover:text-brand-700">{label}</a>;
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      {icon && <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blush-50 text-blush-500">{icon}</div>}
      <div className="font-semibold text-brand-800">{title}</div>
      {children && <div className="max-w-sm text-sm text-ink-500">{children}</div>}
    </div>
  );
}

export function timeAgo(d: Date | string | null | undefined) {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.round(ms / 60000);
  if (Math.abs(m) < 1) return "just now";
  if (Math.abs(m) < 60) return m > 0 ? `${m}m ago` : `in ${-m}m`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 48) return h > 0 ? `${h}h ago` : `in ${-h}h`;
  const days = Math.round(h / 24);
  return days > 0 ? `${days}d ago` : `in ${-days}d`;
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: process.env.TIMEZONE || "Asia/Kolkata" }).format(new Date(d));
}

export function fmtDay(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: process.env.TIMEZONE || "Asia/Kolkata" }).format(new Date(d));
}
