import Link from "next/link";
import { desc } from "drizzle-orm";
import { clsx } from "clsx";
import { db, schema } from "@/lib/db";
import type { DecisionLog } from "@/lib/pipeline/decisionLog";
import { fmtDate, timeAgo } from "@/components/ui";

export const dynamic = "force-dynamic";

const COLUMNS: { title: string; statuses: string[]; highlight?: boolean }[] = [
  { title: "Qualified / Emailed", statuses: ["QUALIFIED", "EMAILED"] },
  { title: "Follow-up 1", statuses: ["FOLLOWUP_1_SENT"] },
  { title: "Follow-up 2", statuses: ["FOLLOWUP_2_SENT"] },
  { title: "In conversation", statuses: ["IN_CONVERSATION"] },
  { title: "Meeting booked", statuses: ["MEETING_BOOKED"] },
  { title: "Input needed", statuses: ["INPUT_NEEDED"], highlight: true },
  { title: "Backup", statuses: ["BACKUP"] },
  { title: "Nurture", statuses: ["NURTURE"] },
  { title: "Disqualified", statuses: ["DISQUALIFIED"] },
  { title: "Unreachable", statuses: ["UNREACHABLE"] },
  { title: "Do not contact", statuses: ["DO_NOT_CONTACT"] },
];

export default async function Board() {
  const companies = await db().select().from(schema.companies).orderBy(desc(schema.companies.updatedAt));
  const convs = await db().select().from(schema.conversations);
  const lastAct = new Map(convs.map((c) => [c.companyId, c.lastActivityAt]));
  return (
    <div className="space-y-4">
      <div><h1 className="h1">Pipeline board (CRM)</h1><p className="muted">Companies + conversations + meetings + events. Click a card for its full decision log.</p></div>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const items = companies.filter((c) => col.statuses.includes(c.status));
          return (
            <div key={col.title} className={clsx("w-64 shrink-0 rounded-xl p-2", col.highlight ? "bg-amber-50 ring-2 ring-amber-300" : "bg-slate-100")}>
              <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-slate-600"><span>{col.title}</span><span>{items.length}</span></div>
              <div className="space-y-2">
                {items.map((c) => {
                  const log = c.decisionLog as DecisionLog | null;
                  return (
                    <Link key={c.id} href={`/companies/${c.domain}`} className="block rounded-lg border border-slate-200 bg-white p-2.5 text-sm shadow-sm hover:border-brand-500">
                      <div className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{c.name ?? c.domain}</span>{c.score !== null && <span className="rounded bg-brand-50 px-1.5 text-xs font-bold text-brand-800">{c.score}</span>}</div>
                      <div className="truncate text-xs text-slate-500">{c.domain}</div>
                      {log?.contact?.chosen && <div className="mt-1 truncate text-xs">{log.contact.chosen.name} · {log.contact.chosen.title}</div>}
                      {c.flags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{c.flags.map((f) => <span key={f} className="rounded bg-amber-100 px-1 text-[10px] text-amber-900">{f}</span>)}</div>}
                      {c.status === "INPUT_NEEDED" && c.inputNeededReason && <div className="mt-1 text-xs font-medium text-amber-800">{c.inputNeededReason}</div>}
                      {(c.status === "BACKUP" || c.status === "NURTURE") && <div className="mt-1 text-xs text-violet-700">Revisit {fmtDate(c.revisitAfter)}{c.backupReason ? ` · ${c.backupReason}` : ""}</div>}
                      <div className="mt-1 text-[11px] text-slate-400">Last activity {timeAgo(lastAct.get(c.id) ?? c.updatedAt)}</div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
