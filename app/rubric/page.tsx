import { Globe, ShieldX, Zap, Target, Gavel, ChevronDown, Newspaper } from "lucide-react";
import {
  GATES, GATE_IDS, SIGNALS, SIGNAL_IDS, QUALIFY_MIN_SCORE, PAGE_PRIORITY, REQUIREMENT_SOURCES, CONTACT_PRIORITY, TITLE_TIERS,
  BANNED_TITLE_RE, GENERIC_INBOXES, HUNTER_MIN_CONFIDENCE, PAIN_LIBRARY, SPRINTO_FACTS, BANNED_PHRASES, EMAIL_LIMITS, T6_MAX_AGE_DAYS, EARLY_MAX_HEADCOUNT,
  type GateId, type SignalId,
} from "@/lib/rubric";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/env";
import type { DecisionLog } from "@/lib/pipeline/decisionLog";
import { Card, Pill } from "@/components/ui";
import { RubricSimulator } from "@/components/RubricSimulator";

export const dynamic = "force-dynamic";

/** Plain-English "why this matters" for each gate and signal. */
const GATE_WHY: Record<GateId, string> = {
  G1: "Sprinto sells to software companies. Agencies, consultancies and hardware makers don't run SOC 2 the same way.",
  G2: "Consumer apps rarely get asked for SOC 2. Business buyers send security questionnaires.",
  G3: "If they already hold SOC 2 or ISO 27001, the urgent problem is solved (an audit in progress is a signal, not a fail).",
  G4: "Already on Vanta, Drata, Secureframe or Sprinto means a rip-and-replace sale, not this campaign.",
  G5: "Public companies and 1,000+ person firms have in-house GRC teams and a different buying process.",
};
const SIGNAL_WHY: Record<SignalId, string> = {
  T1: "They're hiring for compliance or security: someone is about to own this problem.",
  T2: "They've said an audit is underway. Evidence-collection pain is happening right now.",
  T3: "An enterprise plan (SSO, SLA, audit logs) means enterprise buyers, and enterprise buyers ask for SOC 2.",
  T4: "Named big-company or regulated customers (banks, health, government) demand certification.",
  T5: "They talk about GDPR or DPAs but show no certification: aware of compliance, not yet certified.",
  T6: `A funding round, enterprise launch, expansion or big customer win in the last ${T6_MAX_AGE_DAYS} days, from their site or the news.`,
  F1: "Series A to C: big enough to sell to enterprises, small enough to need help.",
  F2: "20 to 500 people (or 5+ open roles): the sweet spot for an automated compliance tool.",
};

const STEPS = [
  { icon: Globe, title: "Research", text: `Homepage, then up to ${config.maxExtraFetches} pages the code picks (careers, security, pricing…) plus a news-headline check.`, tone: "from-lavender-300 to-brand-500" },
  { icon: ShieldX, title: "5 hard gates", text: "Any single fail means disqualified. No score can rescue it.", tone: "from-rose-400 to-rose-600" },
  { icon: Zap, title: "Timing signals", text: "Is there a reason to buy now? At least one is required.", tone: "from-brand-500 to-brand-700" },
  { icon: Target, title: "Fit + score", text: `Points add up; ${QUALIFY_MIN_SCORE}+ is a strong lead. Below that it is still emailed, but flagged.`, tone: "from-blush-400 to-blush-600" },
  { icon: Gavel, title: "Verdict", text: "Qualified, Nurture, Disqualified or Input needed, each backed by quotes and links.", tone: "from-zest-400 to-zest-500" },
];

const VERDICTS: [string, string, string][] = [
  ["bg-rose-500", "DISQUALIFIED", "Any gate fails."],
  ["bg-amber-400", "INPUT NEEDED", "We can't tell whether they sell software (G1) or sell to businesses (G2). A human decides."],
  ["bg-zest-400", "NURTURE", "All gates pass but no timing signal. Parked and re-checked in 60 days. No email."],
  ["bg-emerald-500", "QUALIFIED", `Gates pass and at least one timing signal. Score ${QUALIFY_MIN_SCORE}+ is strong; below that it is emailed with a "low score" flag.`],
  ["bg-ink-500", "UNREACHABLE", "The site blocked us (bot wall, login, CAPTCHA). We never bypass these."],
];

export default async function RubricPage() {
  const rows = await db().select({ verdict: schema.companies.verdict, log: schema.companies.decisionLog }).from(schema.companies);
  const logs = rows.map((r) => r.log as DecisionLog | null).filter((l): l is DecisionLog => !!l && !!l.gates && Object.keys(l.gates).length > 0);
  const gateFails = (g: GateId) => logs.filter((l) => l.gates[g]?.status === "fail").length;
  const signalFires = (s: SignalId) => logs.filter((l) => l.signals[s]?.fired).length;
  const verdicts = ["QUALIFIED", "NURTURE", "DISQUALIFIED", "INPUT_NEEDED", "UNREACHABLE"].map((v) => ({ v, n: rows.filter((r) => r.verdict === v).length }));
  const total = logs.length;

  return (
    <div className="space-y-6">
      <div className="reveal">
        <h1 className="h1">What makes a lead qualified</h1>
        <p className="muted mt-1 max-w-3xl">The AI only <b>reads and quotes</b> the website and the news. Plain code then applies the rules below, the same way every time, so you can always see exactly why a company was emailed or skipped.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.title} className="card card-hover reveal relative p-4" style={{ animationDelay: `${40 + i * 60}ms` }}>
              <div className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${s.tone} text-white shadow-soft`}><Icon size={18} /></div>
              <div className="mt-3 text-[11px] font-bold text-ink-500">STEP {i + 1}</div>
              <div className="font-semibold text-brand-900">{s.title}</div>
              <div className="mt-0.5 text-xs text-ink-500">{s.text}</div>
              {i < STEPS.length - 1 && <div className="absolute -right-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-white text-blush-500 shadow-soft md:grid">→</div>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {verdicts.map(({ v, n }, i) => (
          <div key={v} className="reveal rounded-xl bg-white px-3 py-2 text-sm shadow-soft ring-1 ring-brand-50" style={{ animationDelay: `${300 + i * 40}ms` }}>
            <b className="text-brand-900">{n}</b> <span className="text-ink-500">{v.replace("_", " ").toLowerCase()}</span>
          </div>
        ))}
        <div className="self-center text-xs text-ink-500">so far, across {rows.length} companies researched</div>
      </div>

      <Card title="Try it: click the rules and watch the verdict change" delay={320}>
        <RubricSimulator />
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Step 2 · Hard gates: any fail and we stop" delay={360}>
          <ul className="space-y-2.5">
            {GATE_IDS.map((g) => {
              const n = gateFails(g);
              return (
                <li key={g} className="rounded-xl bg-cream-50 p-3 ring-1 ring-brand-50">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-rose-100 text-xs font-bold text-rose-700">{g}</span>
                    <span className="font-semibold text-brand-900">{GATES[g].name}</span>
                    <span className="ml-auto text-xs text-ink-500">{n ? <b className="text-rose-600">{n} knocked out</b> : "none knocked out yet"}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-ink-700">{GATE_WHY[g]}</p>
                  <p className="mt-1 text-[11px] text-ink-500">If the site doesn&apos;t say: {GATES[g].ifUnknown}</p>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Steps 3–4 · Signals and points" delay={400}>
          <ul className="space-y-2.5">
            {SIGNAL_IDS.map((s) => {
              const n = signalFires(s);
              const timing = SIGNALS[s].layer === "timing";
              return (
                <li key={s} className="rounded-xl bg-cream-50 p-3 ring-1 ring-brand-50">
                  <div className="flex items-center gap-2">
                    <span className={`grid h-7 w-7 place-items-center rounded-lg text-xs font-bold ${timing ? "bg-lavender-200 text-brand-800" : "bg-blush-100 text-blush-700"}`}>{s}</span>
                    <span className="font-semibold text-brand-900">{SIGNALS[s].name}</span>
                    <span className="rounded-md bg-zest-300 px-1.5 text-xs font-bold text-brand-900">+{SIGNALS[s].points}</span>
                    {s === "T6" && <Newspaper size={14} className="text-blush-500" />}
                    <span className="ml-auto text-xs text-ink-500">{timing ? "timing" : "fit"}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-ink-700">{SIGNAL_WHY[s]}</p>
                  {total > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-lavender-100"><div className="h-full animate-grow-x rounded-full bg-gradient-to-r from-brand-600 to-blush-500" style={{ width: `${(n / total) * 100}%`, transformOrigin: "left" }} /></div>
                      <span className="text-[11px] text-ink-500">seen in {n}/{total}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card title="Step 5 · How the verdict is decided" delay={440}>
        <div className="grid gap-2 md:grid-cols-2">
          {VERDICTS.map(([c, t, d]) => (
            <div key={t} className="flex items-start gap-3 rounded-xl bg-cream-50 p-3 ring-1 ring-brand-50">
              <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${c}`} />
              <div><div className="text-sm font-bold text-brand-900">{t}</div><div className="text-sm text-ink-700">{d}</div></div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-500">Every fact behind a verdict is a verbatim quote from a page or headline, with a link. Claims the model can&apos;t quote are thrown away before the rules run.</p>
      </Card>

      <details className="card reveal group overflow-hidden" style={{ animationDelay: "480ms" }}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 font-semibold text-brand-900">
          Technical details: research loop, who we email, pain points, email rules
          <ChevronDown size={18} className="ml-auto text-ink-500 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-6 border-t border-brand-50 px-5 py-5">
          <section>
            <h3 className="mb-1 font-semibold text-brand-900">Research loop</h3>
            <p className="text-sm">Homepage first, then at most <b>{config.maxExtraFetches}</b> extra pages (HTTP cap {config.maxHttpRequests}), chosen by what is still missing. Priority: {PAGE_PRIORITY.join(" → ")}. In parallel, a news-headline check ({config.newsSource === "off" ? "off" : `${config.newsSource} news RSS`}).</p>
            <table className="tbl mt-2"><thead><tr><th>Still missing</th><th>Pages that can fill it</th></tr></thead><tbody>
              {Object.entries(REQUIREMENT_SOURCES).map(([r, p]) => <tr key={r}><td>{r}</td><td>{p.join(", ")}</td></tr>)}
            </tbody></table>
          </section>
          <section>
            <h3 className="mb-1 font-semibold text-brand-900">Who we email (decision-maker)</h3>
            <table className="tbl"><thead><tr><th>Company stage</th><th>Priority</th></tr></thead><tbody>
              <tr><td>Seed / Series A or ≤ {EARLY_MAX_HEADCOUNT} people</td><td>{CONTACT_PRIORITY.early.join(" → ")}</td></tr>
              <tr><td>Series B/C+ or &gt; {EARLY_MAX_HEADCOUNT} people</td><td>{CONTACT_PRIORITY.growth.join(" → ")}</td></tr>
              <tr><td>Stage unknown</td><td>{CONTACT_PRIORITY.unknown.join(" → ")}</td></tr>
            </tbody></table>
            <table className="tbl mt-2"><thead><tr><th>Tier</th><th>Title pattern</th></tr></thead><tbody>
              {Object.entries(TITLE_TIERS).map(([k, re]) => <tr key={k}><td>{k}</td><td className="mono break-all">{re.source}</td></tr>)}
            </tbody></table>
            <p className="mt-2 text-xs">Never: <span className="mono break-all">{BANNED_TITLE_RE.source}</span>; generic inboxes {GENERIC_INBOXES.map((g) => `${g}@`).join(", ")}; Hunter confidence &lt; {HUNTER_MIN_CONFIDENCE}.</p>
          </section>
          <section>
            <h3 className="mb-1 font-semibold text-brand-900">Pain points (two per email, each tied to a fired signal)</h3>
            <table className="tbl"><thead><tr><th>Pain</th><th>Needs signal</th><th>Description</th></tr></thead><tbody>
              {Object.entries(PAIN_LIBRARY).map(([k, p]) => <tr key={k}><td className="mono">{k}</td><td>{p.signals.join(", ")}</td><td>{p.text}</td></tr>)}
            </tbody></table>
          </section>
          <section>
            <h3 className="mb-1 font-semibold text-brand-900">Email rules (quality gate)</h3>
            <p className="text-sm">Cold ≤ {EMAIL_LIMITS.COLD_MAX_WORDS} words, follow-up ≤ {EMAIL_LIMITS.FOLLOWUP_MAX_WORDS}, subject ≤ {EMAIL_LIMITS.SUBJECT_MAX_WORDS} words. The only Sprinto claims allowed:</p>
            <ul className="list-disc pl-5 text-sm">{SPRINTO_FACTS.map((f) => <li key={f}>{f}</li>)}</ul>
            <div className="mt-2 flex flex-wrap gap-1">{BANNED_PHRASES.map((b) => <Pill key={b} tone="red">{b}</Pill>)}</div>
          </section>
        </div>
      </details>
    </div>
  );
}
