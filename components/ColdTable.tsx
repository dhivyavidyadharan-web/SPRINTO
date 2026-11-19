"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { Search, RotateCcw, Ban, Loader2, CalendarClock, MessageSquareQuote, Snowflake } from "lucide-react";

export type ColdRow = {
  companyId: number; domain: string; name: string; kind: string; kindLabel: string; reason: string;
  contact: string | null; contactTitle: string | null; score: number | null; emailsSent: number;
  lastReply: string | null; lastActivity: string; revisitAfter: string | null;
};

const KIND_STYLE: Record<string, string> = {
  declined: "bg-rose-100 text-rose-700",
  no_reply: "bg-sky-100 text-sky-800",
  cooling: "bg-blush-100 text-blush-700",
  nurture: "bg-zest-200 text-brand-900",
  parked: "bg-lavender-200 text-brand-800",
  unsubscribed: "bg-ink-900 text-white",
};

function rel(iso: string | null) {
  if (!iso) return "—";
  const d = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (d === 0) return "today";
  return d > 0 ? `in ${d}d` : `${-d}d ago`;
}

export function ColdTable({ rows, compact = false }: { rows: ColdRow[]; compact?: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<string>("");

  const kinds = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const r of rows) m.set(r.kind, { label: r.kindLabel, n: (m.get(r.kind)?.n ?? 0) + 1 });
    return [...m.entries()];
  }, [rows]);

  const shown = rows.filter((r) => (filter === "all" || r.kind === filter) && (!q || `${r.name} ${r.domain} ${r.contact ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const list = compact ? shown.slice(0, 5) : shown;

  async function act(id: number, action: "reengage" | "dnc") {
    setBusy(id); setToast("");
    try {
      const r = await fetch(`/api/cold/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const j = await r.json();
      setToast(r.ok ? (j.note ?? "Done") : j.error ?? "Failed");
      router.refresh();
    } finally { setBusy(null); }
  }

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-50 text-sky-500"><Snowflake size={22} /></div>
        <div className="font-semibold text-brand-800">No cold deals</div>
        <div className="max-w-xs text-sm text-ink-500">Deals that decline, stop replying, or aren&apos;t ready yet will show up here with their revisit date.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setFilter("all")} className={clsx("rounded-full px-3 py-1 text-xs font-semibold transition", filter === "all" ? "bg-brand-700 text-white shadow-soft" : "bg-white text-brand-800 ring-1 ring-brand-100 hover:ring-blush-300")}>All · {rows.length}</button>
          {kinds.map(([k, v]) => (
            <button key={k} onClick={() => setFilter(k)} className={clsx("rounded-full px-3 py-1 text-xs font-semibold transition", filter === k ? "bg-brand-700 text-white shadow-soft" : "bg-white text-brand-800 ring-1 ring-brand-100 hover:ring-blush-300")}>{v.label} · {v.n}</button>
          ))}
          <div className="relative ml-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500" />
            <input className="input !w-56 !py-1.5 pl-8" placeholder="Search company or contact" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Company</th><th>Why cold</th>{!compact && <th>Contact</th>}<th>Last touch</th><th>Revisit</th>{!compact && <th>Emails</th>}<th className="text-right">Actions</th></tr></thead>
          <tbody>
            {list.map((r, i) => (
              <Fragment key={r.companyId}>
                <tr className="reveal" style={{ animationDelay: `${i * 45}ms` }}>
                  <td>
                    <Link href={`/companies/${r.domain}`} className="font-semibold text-brand-800 hover:text-blush-600">{r.name}</Link>
                    <div className="text-xs text-ink-500">{r.domain}{r.score !== null ? ` · score ${r.score}` : ""}</div>
                  </td>
                  <td>
                    <span className={clsx("rounded-md px-1.5 py-0.5 text-[11px] font-semibold", KIND_STYLE[r.kind])}>{r.kindLabel}</span>
                    <div className="mt-1 text-xs text-ink-700">{r.reason}</div>
                  </td>
                  {!compact && <td className="text-xs">{r.contact ? <><div className="font-medium text-ink-900">{r.contact}</div><div className="text-ink-500">{r.contactTitle}</div></> : <span className="text-ink-500">—</span>}</td>}
                  <td className="whitespace-nowrap text-xs text-ink-700">{rel(r.lastActivity)}</td>
                  <td className="whitespace-nowrap">{r.revisitAfter ? <span className="inline-flex items-center gap-1 rounded-md bg-cream-200 px-1.5 py-0.5 text-[11px] font-semibold text-brand-800"><CalendarClock size={12} />{rel(r.revisitAfter)}</span> : <span className="text-xs text-ink-500">—</span>}</td>
                  {!compact && <td className="text-xs">{r.emailsSent}</td>}
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      {r.lastReply && (
                        <button title="Show their last reply" onClick={() => setOpen(open === r.companyId ? null : r.companyId)} className={clsx("rounded-lg p-1.5 transition hover:bg-blush-50", open === r.companyId ? "text-blush-600" : "text-ink-500")}><MessageSquareQuote size={15} /></button>
                      )}
                      {["declined", "no_reply", "nurture", "parked"].includes(r.kind) && (
                        <button disabled={busy === r.companyId} onClick={() => act(r.companyId, "reengage")} className="btn-secondary !px-2 !py-1 text-xs">
                          {busy === r.companyId ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Re-engage
                        </button>
                      )}
                      {!compact && r.kind !== "unsubscribed" && (
                        <button disabled={busy === r.companyId} title="Do not contact" onClick={() => act(r.companyId, "dnc")} className="rounded-lg p-1.5 text-ink-500 transition hover:bg-rose-50 hover:text-rose-600"><Ban size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
                {open === r.companyId && r.lastReply && (
                  <tr key={`${r.companyId}-reply`}><td colSpan={compact ? 5 : 7} className="!bg-blush-50/50"><div className="quote whitespace-pre-wrap not-italic">“{r.lastReply}”</div></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {compact && shown.length > 5 && <Link href="/cold" className="text-xs font-semibold text-blush-600 hover:text-brand-700">View all {shown.length} cold deals →</Link>}
      {toast && <div className="reveal rounded-xl bg-brand-700 px-3 py-2 text-xs text-white shadow-soft">{toast}</div>}
    </div>
  );
}
