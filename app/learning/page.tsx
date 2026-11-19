import Link from "next/link";
import { desc, inArray, like, ne } from "drizzle-orm";
import { BrainCircuit, FlaskConical, Sparkles, Scale, Eye, History, Database, ShieldCheck } from "lucide-react";
import { db, schema } from "@/lib/db";
import { SIGNALS, type SignalId } from "@/lib/rubric";
import { LEARN, EXPERIMENT_LIBRARY, experimentDecision, pct, type Rate } from "@/lib/learning/stats";
import { lastLearningRun, loadRubricOverrides, loadSamples } from "@/lib/learning";
import { Card, Pill, fmtDate, timeAgo } from "@/components/ui";
import { RunLearningButton, SuggestionButtons, ResetOverridesButton, RuleStatusButton } from "@/components/LearningActions";

export const dynamic = "force-dynamic";

const ORIGIN: Record<string, { label: string; cls: string }> = {
  outcome: { label: "learned from replies", cls: "bg-lavender-200 text-brand-800" },
  experiment: { label: "A/B winner", cls: "bg-zest-200 text-brand-900" },
};
const STATUS: Record<string, { label: string; tone: "amber" | "green" | "slate" }> = {
  trial: { label: "on trial (50% of emails)", tone: "amber" },
  active: { label: "live on every email", tone: "green" },
  retired: { label: "dropped", tone: "slate" },
};

function Meter({ have, need, label }: { have: number; need: number; label: string }) {
  const p = Math.min(100, (have / Math.max(1, need)) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="text-ink-700">{label}</span><span className="font-semibold text-brand-900">{have} / {need}</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-lavender-100"><div className="h-full animate-grow-x rounded-full bg-gradient-to-r from-brand-600 to-blush-500" style={{ width: `${p}%`, transformOrigin: "left" }} /></div>
    </div>
  );
}

function ArmBar({ label, r, win }: { label: string; r: Rate; win: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`w-5 font-bold ${win ? "text-emerald-600" : "text-brand-800"}`}>{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-lavender-100"><div className={`h-full rounded-full ${win ? "bg-emerald-500" : "bg-brand-500"}`} style={{ width: `${r.n ? Math.max(3, r.rate * 100) : 0}%` }} /></div>
      <span className="w-28 text-right text-ink-500">{r.wins}/{r.n} replied · {pct(r.rate)}</span>
    </div>
  );
}

export default async function LearningPage() {
  const overrides = await loadRubricOverrides();
  const { samples, pending, total } = await loadSamples();
  const last = await lastLearningRun();
  const autoRules = await db().select().from(schema.rules).where(ne(schema.rules.origin, "human")).orderBy(desc(schema.rules.id));
  const experiments = await db().select().from(schema.experiments).orderBy(desc(schema.experiments.id));
  const suggestions = await db().select().from(schema.learningSuggestions).orderBy(desc(schema.learningSuggestions.id)).limit(40);
  const log = await db().select().from(schema.events).where(like(schema.events.type, "learning_%")).orderBy(desc(schema.events.id)).limit(25);
  const reviewCompanies = suggestions.filter((s) => s.companyId).map((s) => s.companyId!) ;
  const companies = reviewCompanies.length ? await db().select({ id: schema.companies.id, domain: schema.companies.domain, name: schema.companies.name }).from(schema.companies).where(inArray(schema.companies.id, reviewCompanies)) : [];
  const cName = (id: number | null) => companies.find((c) => c.id === id);

  const running = experiments.find((e) => e.status === "running");
  const runningV = running ? experimentDecision(samples, running.id) : null;
  const libLabel = (d: string) => EXPERIMENT_LIBRARY.find((x) => x.dimension === d)?.label ?? d;
  const pendingSug = suggestions.filter((s) => s.status === "pending");
  const decidedSug = suggestions.filter((s) => s.status !== "pending");
  const successes = samples.filter((s) => s.success).length;
  const overrideList = Object.entries(overrides) as [SignalId, number][];

  return (
    <div className="space-y-6">
      <section className="grad-hero reveal relative overflow-hidden rounded-3xl px-6 py-7 text-white shadow-lift md:px-8">
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 animate-floaty rounded-full bg-zest-300/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-sm text-white/70"><BrainCircuit size={16} /> Self-learning</div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">The agent teaches itself <span className="text-zest-300">from every reply</span></h1>
            <p className="mt-2 text-sm text-white/80">Each day it looks at which emails got replies, tests its own ideas on half the new emails, runs A/B tests on its writing, and questions its own verdicts. Anything that changes the rubric or reopens a company waits for your yes.</p>
            <p className="mt-2 text-xs text-white/60">Runs daily at 09:30 IST {last ? `· last run ${timeAgo(new Date(last.ranAt))}` : "· not run yet"}</p>
          </div>
          <RunLearningButton />
        </div>
      </section>

      {/* Data readiness */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="What it's learning from" icon={<Database size={16} className="text-blush-500" />} delay={60}>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span>Cold emails sent</span><b>{total}</b></div>
            <div className="flex justify-between"><span>…with a known outcome</span><b>{samples.length}</b></div>
            <div className="flex justify-between"><span>…positive reply or booked</span><b className="text-emerald-600">{successes}</b></div>
            <div className="flex justify-between text-ink-500"><span>Still waiting (&lt; {LEARN.NO_REPLY_DAYS} days, no reply)</span><b>{pending}</b></div>
          </div>
        </Card>
        <Card title="How close it is to learning" delay={100}>
          <div className="space-y-3">
            <Meter have={samples.length} need={LEARN.MIN_GROUP + LEARN.MIN_REST} label="A · spot a pattern" />
            <Meter have={runningV ? Math.min(runningV.a.n, runningV.b.n) : 0} need={LEARN.EXP_MIN_PER_ARM} label="B · call the A/B test (per arm)" />
            <Meter have={samples.length} need={LEARN.SIGNAL_MIN + LEARN.MIN_REST} label="C · suggest rubric changes" />
          </div>
        </Card>
        <Card title="Guardrails" icon={<ShieldCheck size={16} className="text-emerald-600" />} delay={140}>
          <ul className="space-y-1 text-xs text-ink-700">
            <li>• No rule from small samples: {LEARN.MIN_GROUP}+ emails and ~95% confidence.</li>
            <li>• New ideas go on trial on 50% of emails; kept only if they do at least as well.</li>
            <li>• Live auto rules roll back if results clearly drop.</li>
            <li>• Rubric changes and re-research need your approval; points stay within 0–4.</li>
            <li>• It can never change who gets emailed (live-test lock).</li>
          </ul>
        </Card>
      </div>

      {/* C: waiting for you */}
      {pendingSug.length > 0 && (
        <Card title={`Waiting for your decision (${pendingSug.length})`} icon={<Eye size={16} className="text-blush-500" />} delay={160} className="ring-2 ring-blush-200">
          <ul className="space-y-3">
            {pendingSug.map((s) => (
              <li key={s.id} className="rounded-xl bg-cream-50 p-3 ring-1 ring-brand-50">
                <div className="flex flex-wrap items-center gap-2">
                  {s.kind === "signal_points"
                    ? <><Pill tone="amber">rubric change</Pill><b className="text-brand-900">{s.target} {SIGNALS[s.target as SignalId]?.name}</b><span className="text-sm">{(s.current as { points: number }).points} → <b>{(s.proposed as { points: number }).points}</b> points</span></>
                    : <><Pill tone="red">second opinion</Pill><Link href={`/companies/${s.target}`} className="font-semibold text-brand-900 hover:text-blush-600">{cName(s.companyId)?.name ?? s.target}</Link><span className="text-xs text-ink-500">was {(s.current as { verdict: string }).verdict}</span></>}
                  <span className="ml-auto text-xs text-ink-500">{timeAgo(s.createdAt)}</span>
                </div>
                <p className="mt-1.5 text-sm text-ink-700">{s.rationale}</p>
                {s.kind === "verdict_review" && (s.evidence as { issues?: string[] })?.issues?.length ? (
                  <ul className="mt-1 list-disc pl-5 text-xs text-ink-700">{(s.evidence as { issues: string[] }).issues.map((i) => <li key={i}>{i}</li>)}</ul>
                ) : null}
                <div className="mt-2"><SuggestionButtons id={s.id} kind={s.kind} /></div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* A */}
        <Card title="A · Rules it learned from replies" icon={<Sparkles size={16} className="text-blush-500" />} delay={200}>
          {autoRules.filter((r) => r.origin === "outcome").length === 0 ? (
            <div className="space-y-2 text-sm text-ink-700">
              <p>No learned rules yet. Once {LEARN.MIN_GROUP + LEARN.MIN_REST}+ emails have outcomes, it compares reply rates by opening line, pain point and length, overall and per role and company stage. Example of what it can learn:</p>
              <p className="quote">For growth-stage (Series B+) companies, use the &quot;Engineers pulled off roadmap to gather audit evidence&quot; pain point when it is available.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {autoRules.filter((r) => r.origin === "outcome").map((r) => {
                const ev = (r.evidence ?? {}) as { found?: { group: Rate; rest: Rate; z: number }; trial?: { reason: string } };
                const st = STATUS[r.status] ?? STATUS.retired;
                return (
                  <li key={r.id} className={`rounded-xl p-3 ring-1 ${r.status === "retired" ? "bg-cream-50 opacity-60 ring-cream-200" : "bg-white ring-brand-100"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono text-ink-500">R{r.id}</span><Pill tone={r.kind === "do" ? "green" : "red"}>{r.kind === "do" ? "DO" : "DON'T"}</Pill><Pill tone={st.tone}>{st.label}</Pill>
                      <span className="ml-auto flex gap-1">
                        {r.status === "trial" && <RuleStatusButton id={r.id} to="active" label="Make live now" />}
                        {r.status !== "retired" && <RuleStatusButton id={r.id} to="retired" label="Drop" />}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-brand-900">{r.text}</p>
                    <p className="mt-1 text-[11px] text-ink-500">
                      {ev.found && <>Found: {ev.found.group.wins}/{ev.found.group.n} replied vs {ev.found.rest.wins}/{ev.found.rest.n} otherwise (z={ev.found.z}). </>}
                      {ev.trial?.reason && <>Trial: {ev.trial.reason}.</>}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          {last?.patterns?.length ? (
            <details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold text-brand-800">All patterns from the last run ({last.patterns.length})</summary>
              <ul className="mt-1 space-y-1">{last.patterns.map((p) => <li key={p.key}>{p.text} <span className="text-ink-500">({p.group} vs {p.rest}, z={p.z})</span></li>)}</ul>
            </details>
          ) : null}
        </Card>

        {/* B */}
        <Card title="B · A/B tests it runs on itself" icon={<FlaskConical size={16} className="text-blush-500" />} delay={240}>
          {running && runningV ? (
            <div className="rounded-xl bg-gradient-to-br from-lavender-100 to-blush-50 p-3 ring-1 ring-brand-100">
              <div className="flex items-center gap-2"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping2 rounded-full bg-blush-500" /><span className="relative inline-flex h-2 w-2 rounded-full bg-blush-500" /></span><b className="text-brand-900">Running: {libLabel(running.dimension)}</b><span className="ml-auto text-xs text-ink-500">since {fmtDate(running.startedAt)}</span></div>
              <div className="mt-2 grid gap-1 text-xs text-ink-700"><div><b>A:</b> {running.armA}</div><div><b>B:</b> {running.armB}</div></div>
              <div className="mt-3 space-y-1.5"><ArmBar label="A" r={runningV.a} win={false} /><ArmBar label="B" r={runningV.b} win={false} /></div>
              <p className="mt-2 text-xs text-ink-500">{runningV.reason}. Every new cold email is split 50/50. A winner needs {LEARN.EXP_MIN_PER_ARM}+ outcomes per arm and a clear difference; it then becomes a live rule.</p>
            </div>
          ) : <p className="muted">No experiment running yet. Click <b>Run learning now</b> to start the first one.</p>}
          <ul className="mt-3 space-y-2">
            {experiments.filter((e) => e.status === "concluded").map((e) => {
              const res = (e.result ?? {}) as { a?: Rate; b?: Rate; reason?: string };
              return (
                <li key={e.id} className="rounded-xl bg-cream-50 p-3 text-sm ring-1 ring-brand-50">
                  <div className="flex items-center gap-2"><b className="text-brand-900">{libLabel(e.dimension)}</b>{e.winner && e.winner !== "none" ? <Pill tone="green">winner: {e.winner}</Pill> : <Pill>no clear winner</Pill>}<span className="ml-auto text-xs text-ink-500">{e.concludedAt ? fmtDate(e.concludedAt) : ""}</span></div>
                  {res.a && res.b && <div className="mt-1.5 space-y-1"><ArmBar label="A" r={res.a} win={e.winner === "A"} /><ArmBar label="B" r={res.b} win={e.winner === "B"} /></div>}
                  {e.winnerRuleId && <p className="mt-1 text-xs text-ink-500">Now rule R{e.winnerRuleId} on every email.</p>}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[11px] text-ink-500">Queue: {EXPERIMENT_LIBRARY.map((d) => d.label).join(" → ")}.</p>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* C */}
        <Card title="C · Self-review of the rubric and its verdicts" icon={<Scale size={16} className="text-blush-500" />} delay={280}
          right={overrideList.length ? <ResetOverridesButton /> : undefined}>
          <div className="space-y-3 text-sm">
            <div>
              <div className="font-semibold text-brand-900">Approved point changes</div>
              {overrideList.length === 0 ? <p className="text-ink-500">None. The rubric uses its coded defaults.</p> : (
                <ul className="mt-1 flex flex-wrap gap-2">{overrideList.map(([k, v]) => <li key={k} className="rounded-lg bg-zest-100 px-2 py-1 text-xs ring-1 ring-zest-300"><b>{k}</b> {SIGNALS[k].name}: {SIGNALS[k].points} → <b>{v}</b></li>)}</ul>
              )}
            </div>
            <p className="text-xs text-ink-500">Rubric check: it compares reply rates of emailed leads with and without each signal and proposes ±1 point. Verdict check: a week after a company is Disqualified or Nurtured, it re-reads the evidence for weak spots (e.g. a cert read off a privacy policy, key pages never fetched) and flags ones worth re-researching.</p>
            <ul className="space-y-1.5">
              {decidedSug.slice(0, 12).map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-xs">
                  <Pill tone={s.status === "approved" ? "green" : s.status === "confirmed" ? "slate" : "red"}>{s.status}</Pill>
                  <span className="text-ink-700">{s.kind === "verdict_review" ? <><Link className="font-semibold text-brand-800" href={`/companies/${s.target}`}>{s.target}</Link>: </> : <b>{s.target}: </b>}{s.rationale}</span>
                </li>
              ))}
              {decidedSug.length === 0 && <li className="text-xs text-ink-500">Nothing reviewed yet. Companies become eligible {7} days after their verdict.</li>}
            </ul>
          </div>
        </Card>

        <Card title="Learning log" icon={<History size={16} className="text-blush-500" />} delay={320}>
          {log.length === 0 ? <p className="muted">No learning activity yet.</p> : (
            <ul className="space-y-1.5 text-xs">
              {log.map((e) => {
                const p = (e.payload ?? {}) as Record<string, unknown>;
                const detail = e.type === "learning_ran"
                  ? `${(p.data as { withOutcome?: number })?.withOutcome ?? 0} emails with outcomes`
                  : String(p.text ?? p.reason ?? p.dimension ?? p.summary ?? p.signal ?? "");
                return (
                  <li key={e.id} className="flex gap-2"><span className="w-24 shrink-0 text-ink-500">{timeAgo(e.ts)}</span><span><b className="text-brand-800">{e.type.replace("learning_", "").replace(/_/g, " ")}</b> {detail}</span></li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
