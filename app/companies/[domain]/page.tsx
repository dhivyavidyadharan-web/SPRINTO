import Link from "next/link";
import { gmailLink } from "@/lib/mail";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { DecisionLog } from "@/lib/pipeline/decisionLog";
import { GATES, GATE_IDS, SIGNALS, SIGNAL_IDS } from "@/lib/rubric";
import type { State } from "@/lib/agent/state";
import { Card, GateStatus, Pill, SourceLink, StatusBadge, fmtDate, timeAgo } from "@/components/ui";
import { FeedbackBox, InputActions, SimulateReply } from "@/components/actions";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const [c] = await db().select().from(schema.companies).where(eq(schema.companies.domain, decodeURIComponent(domain)));
  if (!c) notFound();
  const log = (c.decisionLog ?? null) as DecisionLog | null;
  const emails = await db().select().from(schema.emails).where(eq(schema.emails.companyId, c.id)).orderBy(asc(schema.emails.id));
  const [conv] = await db().select().from(schema.conversations).where(eq(schema.conversations.companyId, c.id));
  const meetings = await db().select().from(schema.meetings).where(eq(schema.meetings.companyId, c.id));
  const events = await db().select().from(schema.events).where(eq(schema.events.companyId, c.id)).orderBy(desc(schema.events.id)).limit(60);
  const rules = await db().select().from(schema.rules);
  const ruleText = new Map(rules.map((r) => [`R${r.id}`, `[${r.kind}] ${r.text}`]));
  const fbs = emails.length ? await db().select().from(schema.feedback) : [];
  const state = (conv?.state ?? null) as State | null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3"><h1 className="h1">{c.name ?? c.domain}</h1><StatusBadge status={c.status} /></div>
          <div className="muted"><a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="underline">{c.domain}</a> · updated {timeAgo(c.updatedAt)}{c.dryRun ? " · DRY RUN" : ""}</div>
        </div>
        <a className="btn-secondary" href={`/api/companies/${c.domain}/log`}>Download decision log (JSON)</a>
      </div>

      {c.status === "INPUT_NEEDED" && (
        <Card title={<span className="text-amber-800">Input needed — {c.inputNeededReason ?? state?.inputNeededReason}</span>} className="ring-2 ring-amber-300">
          <InputActions companyId={c.id} isConversation={!!state && !state.done} reason={c.inputNeededReason ?? state?.inputNeededReason ?? ""} />
        </Card>
      )}

      {!log ? <Card><p className="muted">Not processed yet.</p></Card> : (
        <>
          <Card title="Verdict">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold">{log.verdict}</span>
              <Pill tone="green">score {log.score}</Pill>
              {log.flags.map((f) => <Pill key={f} tone="amber">{f}</Pill>)}
              {log.inputNeededReason && <Pill tone="amber">{log.inputNeededReason}</Pill>}
            </div>
            <p className="mt-2 text-sm leading-relaxed">{log.verdictReason}</p>
            {log.codeRationale && <p className="mt-1 text-xs text-slate-500">Code rationale: {log.codeRationale}</p>}
            {log.stopReason && <p className="text-xs text-slate-500">Loop stop: {log.stopReason} · HTTP requests: {log.httpRequests} · tokens {log.tokens?.in}/{log.tokens?.out} · est. ${log.estCostUsd}</p>}
            {log.errors?.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-xs text-red-600">{log.errors.length} error(s)</summary><pre className="mono whitespace-pre-wrap text-red-700">{log.errors.join("\n\n")}</pre></details>}
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Hard gates">
              <table className="tbl"><thead><tr><th>Gate</th><th>Status</th><th>Evidence</th></tr></thead><tbody>
                {GATE_IDS.map((g) => { const r = log.gates[g]; return (
                  <tr key={g}><td className="whitespace-nowrap"><b>{g}</b> {GATES[g].name}</td><td>{r ? <GateStatus status={r.status} /> : "—"}{r?.note && <div className="text-[11px] text-slate-500">{r.note}</div>}</td><td>{r?.evidence ? <div className="quote">“{r.evidence}”</div> : <span className="text-slate-400">—</span>}<SourceLink url={r?.sourceUrl} /></td></tr>
                ); })}
              </tbody></table>
            </Card>
            <Card title="Signals">
              <table className="tbl"><thead><tr><th>Signal</th><th>Fired</th><th>Evidence</th></tr></thead><tbody>
                {SIGNAL_IDS.map((s) => { const r = log.signals[s]; return (
                  <tr key={s} className={r?.fired ? "" : "opacity-60"}><td className="whitespace-nowrap"><b>{s}</b> {SIGNALS[s].name}</td><td>{r?.fired ? <Pill tone="green">+{r.points}</Pill> : <Pill>no</Pill>}{r?.note && <div className="text-[11px] text-slate-500">{r.note}</div>}</td><td>{r?.evidence ? <div className="quote">“{r.evidence}”</div> : null}<SourceLink url={r?.sourceUrl} /></td></tr>
                ); })}
              </tbody></table>
            </Card>
          </div>

          <Card title="Qualification loop — fetch trail">
            <table className="tbl"><thead><tr><th>#</th><th>Page</th><th>Why</th><th>Status</th><th>Words</th><th>Filled</th></tr></thead><tbody>
              {log.fetchTrail.map((t) => (
                <tr key={t.iteration + t.url}><td>{t.iteration}</td><td><b>{t.pageType}</b><div><SourceLink url={t.url} /></div><div className="text-[11px] text-slate-400">{t.method}</div></td><td className="text-xs">{t.reason}<div className="text-slate-400">missing before: {t.missingBefore.join(", ") || "—"}</div></td><td><Pill tone={t.status === "ok" ? "green" : "red"}>{t.status}</Pill></td><td>{t.words}</td><td className="text-xs">{t.filled.join(", ") || "—"}</td></tr>
              ))}
            </tbody></table>
          </Card>

          {log.contact && (
            <Card title="Decision-maker">
              {log.contact.chosen ? (
                <div className="mb-2 text-sm"><b>{log.contact.chosen.name}</b> — {log.contact.chosen.title} · <span className="mono">{log.contact.chosen.email}</span> {log.contact.chosen.linkedinUrl && <a className="text-brand-700 underline" href={log.contact.chosen.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>} <Pill>{log.contact.chosen.source}</Pill></div>
              ) : <div className="mb-2 text-sm font-medium text-amber-800">No eligible contact — upload one on the Run page to auto-resume.</div>}
              <div className="text-xs text-slate-600">Rule: {log.contact.ruleUsed} · {log.contact.candidatesCount ?? 0} candidates via {log.contact.provider}</div>
              {log.contact.rejected.length > 0 && (
                <table className="tbl mt-2"><thead><tr><th>Rejected</th><th>Title</th><th>Why</th></tr></thead><tbody>
                  {log.contact.rejected.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.title}</td><td className="text-xs">{r.reason}</td></tr>)}
                </tbody></table>
              )}
            </Card>
          )}

          {log.painPoints && (
            <Card title="Pain points (2)">
              <ul className="space-y-2 text-sm">{log.painPoints.map((p) => (
                <li key={p.id}><b>{p.id}</b> <span className="text-xs text-slate-500">({p.citedSignals.join(", ")} · {p.source})</span><div>{p.framing}</div>{p.evidence && <div className="quote mt-1">“{p.evidence}”</div>}</li>
              ))}</ul>
              {log.painPointsRejected && log.painPointsRejected.length > 0 && <div className="mt-2 text-xs text-slate-500">Rejected by code: {log.painPointsRejected.map((r) => `${r.id} (${r.reason})`).join("; ")}</div>}
            </Card>
          )}
        </>
      )}

      {emails.length > 0 && (
        <Card title={`Emails (${emails.length})`}>
          <div className="space-y-5">
            {emails.map((e) => {
              const qg = e.qualityGate as { passed: boolean; attempts: number; failures: string[][] } | null;
              const myFb = fbs.filter((f) => f.emailId === e.id);
              return (
                <div key={e.id} className="space-y-2 border-b border-slate-100 pb-4 last:border-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Pill tone="blue">{e.kind}</Pill><b>{e.subject}</b>
                    <Pill tone={e.sendStatus === "sent" ? "green" : e.sendStatus === "send_failed" ? "red" : "amber"}>{e.sendStatus}</Pill>
                    <span className="text-xs text-slate-500">{fmtDate(e.sentAt ?? e.createdAt)}</span>
                    {e.hookSignalId && <Pill>hook {e.hookSignalId}</Pill>}
                    {e.rulesApplied.length > 0 && <span className="text-xs">Applied rules: {e.rulesApplied.map((r) => <abbr key={r} title={ruleText.get(r) ?? r} className="mr-1 cursor-help rounded bg-slate-100 px-1 font-mono">{r}</abbr>)}</span>}
                  </div>
                  {e.hookQuote && <div className="quote">Hook evidence: “{e.hookQuote}”</div>}
                  <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm">{e.body}</pre>
                  {qg && <div className="text-xs">Quality gate: {qg.passed ? <Pill tone="green">passed</Pill> : <Pill tone="red">failed</Pill>} after {qg.attempts} attempt(s){qg.failures.length > 0 && <span className="text-slate-500"> — earlier failures: {qg.failures.map((f) => f.join("; ")).join(" | ")}</span>}</div>}
                  {myFb.length > 0 && <div className="text-xs text-slate-600">Feedback given: {myFb.map((f) => `${f.verdict === "good" ? "👍" : "👎"} ${f.notWorking ?? f.working ?? ""}`).join(" · ")}</div>}
                  {["cold", "followup_1", "followup_2"].includes(e.kind) && <FeedbackBox emailId={e.id} body={e.body} />}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {conv && (
        <Card title="Conversation" right={<Link className="text-xs text-brand-700 underline" href="/conversations">All conversations</Link>}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm">Stage: <b>{conv.stage}</b> {conv.gmailThreadId && <a className="ml-2 text-xs text-brand-700 underline" target="_blank" rel="noreferrer" href={gmailLink(conv.gmailThreadId) ?? "#"}>Open in Gmail</a>}</div>
              {meetings.map((m) => <div key={m.id} className="text-sm font-semibold text-brand-800">📅 Meeting {fmtDate(m.startAt)}</div>)}
              {state && !state.done && !state.inputNeeded && <SimulateReply companyId={c.id} />}
              <details><summary className="cursor-pointer text-xs text-slate-600">State object</summary><pre className="mono max-h-96 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify({ ...state, history: undefined }, null, 2)}</pre></details>
            </div>
            <ol className="max-h-96 space-y-1 overflow-auto text-xs">
              {(state?.history ?? []).slice().reverse().map((h, i) => <li key={i} className="border-l-2 border-slate-200 pl-2"><span className="text-slate-400">{fmtDate(h.ts)}</span> <b>{h.node}</b> · {h.action} — {h.result}</li>)}
            </ol>
          </div>
        </Card>
      )}

      <Card title="Activity timeline">
        <ul className="space-y-1 text-xs">{events.map((e) => <li key={e.id}><span className="text-slate-400">{fmtDate(e.ts)}</span> <span className="font-semibold uppercase text-slate-500">{e.actor}</span> {e.type.replace(/_/g, " ")} <span className="text-slate-400">{JSON.stringify(e.payload).slice(0, 160)}</span></li>)}</ul>
      </Card>
    </div>
  );
}
