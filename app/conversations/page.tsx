import Link from "next/link";
import { plainStep, stageLabel } from "@/lib/plain";
import { gmailLink } from "@/lib/mail";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { State } from "@/lib/agent/state";
import { Card, Pill, StatusBadge, fmtDate, timeAgo } from "@/components/ui";
import { ConversationsPoller, SimulateReply } from "@/components/actions";

export const dynamic = "force-dynamic";

export default async function Conversations() {
  const rows = await db().select({ conv: schema.conversations, c: schema.companies }).from(schema.conversations).innerJoin(schema.companies, eq(schema.conversations.companyId, schema.companies.id)).orderBy(desc(schema.conversations.lastActivityAt));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="h1">Conversations</h1><p className="muted">Reply to the agent&apos;s emails from your inbox (acting as the prospect), or simulate a reply below.</p></div>
        <ConversationsPoller />
      </div>
      {rows.length === 0 && <Card><p className="muted">No conversations yet — they start when a cold email is sent.</p></Card>}
      {rows.map(({ conv, c }) => {
        const s = conv.state as State | null;
        return (
          <Card key={conv.id} title={<span className="flex items-center gap-2"><Link href={`/companies/${c.domain}`} className="text-brand-700">{c.name ?? c.domain}</Link><StatusBadge status={c.status} /></span>} right={<span className="text-xs text-slate-500">last activity {timeAgo(conv.lastActivityAt)}</span>}>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-1 text-sm">
                <div>{s?.contactName} · {s?.contactTitle}</div>
                <div className="flex flex-wrap gap-1">
                  <Pill tone="blue">{stageLabel(conv.stage)}</Pill>
                  {(s?.followupsSent ?? 0) > 0 && <Pill>{s?.followupsSent} follow-up{s?.followupsSent === 1 ? "" : "s"} sent</Pill>}
                  {s?.meetingStatus === "confirmed" && <Pill tone="green">meeting confirmed</Pill>}
                  {s?.inputNeeded && <Pill tone="amber">needs you: {s.inputNeededReason}</Pill>}
                </div>
                {s?.timesProposed?.length ? <div className="text-xs">Offered: {s.timesProposed.map((t) => fmtDate(t)).join(" · ")}</div> : null}
                
                {conv.gmailThreadId ? <a className="text-xs text-brand-700 underline" target="_blank" rel="noreferrer" href={gmailLink(conv.gmailThreadId) ?? "#"}>Open in Gmail</a> : <span className="text-xs text-slate-400">dry run (nothing sent)</span>}
              </div>
              <ol className="max-h-56 space-y-1 overflow-auto text-xs lg:col-span-1">
                {(s?.history ?? []).slice().reverse().map((h) => ({ h, t: plainStep(h) })).filter((x) => x.t).slice(0, 8).map(({ h, t }, i) => <li key={i} className="border-l-2 border-blush-200 pl-2"><span className="text-ink-500">{timeAgo(h.ts)}</span> · {t}</li>)}
              </ol>
              <div>{s && !s.done && !s.inputNeeded ? <SimulateReply companyId={c.id} /> : <p className="muted">{s?.done ? "Conversation closed." : s?.inputNeeded ? "Paused — see Input needed." : ""}</p>}</div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
