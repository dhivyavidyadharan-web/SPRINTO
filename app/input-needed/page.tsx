import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { State } from "@/lib/agent/state";
import type { DecisionLog } from "@/lib/pipeline/decisionLog";
import { Card, fmtDate, timeAgo } from "@/components/ui";
import { InputActions } from "@/components/actions";

export const dynamic = "force-dynamic";

export default async function InputNeeded() {
  const companies = await db().select().from(schema.companies).where(eq(schema.companies.status, "INPUT_NEEDED")).orderBy(desc(schema.companies.updatedAt));
  const convs = await db().select().from(schema.conversations);
  const byCompany = new Map(convs.map((c) => [c.companyId, c]));
  return (
    <div className="space-y-4">
      <div><h1 className="h1">Input needed</h1><p className="muted">The only human touchpoint: cases the agent could not resolve on its own. Every action is logged with actor “human”.</p></div>
      {companies.length === 0 && <Card><p className="muted">Nothing needs you right now. 🎉</p></Card>}
      {companies.map((c) => {
        const conv = byCompany.get(c.id);
        const s = conv?.state as State | null | undefined;
        const log = c.decisionLog as DecisionLog | null;
        const reason = c.inputNeededReason ?? s?.inputNeededReason ?? "unknown";
        return (
          <Card key={c.id} className="ring-1 ring-amber-200" title={<span><Link href={`/companies/${c.domain}`} className="text-brand-700">{c.name ?? c.domain}</Link> <span className="ml-2 text-amber-800">{reason}</span></span>} right={<span className="text-xs text-slate-500">{timeAgo(c.updatedAt)}</span>}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-1 text-sm">
                <div>Verdict: <b>{log?.verdict ?? c.verdict ?? "—"}</b> · score {c.score ?? "—"}</div>
                {log?.contact?.chosen && <div>Contact: {log.contact.chosen.name} · {log.contact.chosen.title}</div>}
                {s && <div className="text-xs">Reply status <b>{s.replyStatus}</b> · round {s.negotiationRound} · offered {s.timesProposed.map((t) => fmtDate(t)).join(", ") || "—"}</div>}
                {s?.lastReplyText && <div className="quote whitespace-pre-wrap">{s.lastReplyText}</div>}
                {log?.email && !log.email.qualityGate.passed && <div className="text-xs text-red-700">Quality gate failures: {log.email.qualityGate.failures.map((f) => f.join("; ")).join(" | ")}</div>}
                {s && <details className="hidden"><summary className="cursor-pointer text-xs text-slate-600">Full state</summary><pre className="mono max-h-72 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify({ ...s, history: s.history?.slice(-15) }, null, 2)}</pre></details>}
              </div>
              <InputActions companyId={c.id} isConversation={!!s && !s.done} reason={reason} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
