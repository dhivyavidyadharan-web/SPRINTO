import type { ReactNode } from "react";
import { clsx } from "clsx";

export function Card({ title, children, className, right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={clsx("card", className)}>
      {title && <div className="card-h flex items-center justify-between gap-3"><span>{title}</span>{right}</div>}
      <div className="card-b">{children}</div>
    </section>
  );
}

const STATUS_COLORS: Record<string, string> = {
  QUEUED: "bg-slate-100 text-slate-700",
  PROCESSING: "bg-blue-100 text-blue-800",
  QUALIFIED: "bg-emerald-100 text-emerald-800",
  EMAILED: "bg-emerald-100 text-emerald-800",
  FOLLOWUP_1_SENT: "bg-teal-100 text-teal-800",
  FOLLOWUP_2_SENT: "bg-teal-100 text-teal-800",
  IN_CONVERSATION: "bg-sky-100 text-sky-800",
  MEETING_BOOKED: "bg-brand-700 text-white",
  INPUT_NEEDED: "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
  BACKUP: "bg-violet-100 text-violet-800",
  NURTURE: "bg-lime-100 text-lime-800",
  DISQUALIFIED: "bg-rose-100 text-rose-800",
  UNREACHABLE: "bg-zinc-200 text-zinc-700",
  DO_NOT_CONTACT: "bg-zinc-800 text-white",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_COLORS[status] ?? "bg-slate-100 text-slate-700")}>{status.replace(/_/g, " ")}</span>;
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "red" | "amber" | "blue" }) {
  const t = { slate: "bg-slate-100 text-slate-700", green: "bg-emerald-100 text-emerald-800", red: "bg-rose-100 text-rose-800", amber: "bg-amber-100 text-amber-900", blue: "bg-sky-100 text-sky-800" }[tone];
  return <span className={clsx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium", t)}>{children}</span>;
}

export function GateStatus({ status }: { status: string }) {
  return <Pill tone={status === "pass" ? "green" : status === "fail" ? "red" : "amber"}>{status}</Pill>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function SourceLink({ url }: { url?: string | null }) {
  if (!url) return <span className="text-slate-400">—</span>;
  let label = url;
  try { const u = new URL(url); label = u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, ""); } catch { /* keep */ }
  return <a href={url} target="_blank" rel="noreferrer" className="break-all text-xs text-brand-700 underline decoration-dotted">{label}</a>;
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
