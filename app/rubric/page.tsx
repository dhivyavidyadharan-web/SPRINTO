import {
  GATES, GATE_IDS, SIGNALS, SIGNAL_IDS, QUALIFY_MIN_SCORE, PAGE_PRIORITY, REQUIREMENT_SOURCES, CONTACT_PRIORITY, TITLE_TIERS,
  BANNED_TITLE_RE, GENERIC_INBOXES, HUNTER_MIN_CONFIDENCE, PAIN_LIBRARY, SPRINTO_FACTS, BANNED_PHRASES, EMAIL_LIMITS, T6_MAX_AGE_DAYS, EARLY_MAX_HEADCOUNT,
} from "@/lib/rubric";
import { config } from "@/lib/env";
import { Card, Pill } from "@/components/ui";

export default function RubricPage() {
  return (
    <div className="space-y-6">
      <div><h1 className="h1">Rubric</h1><p className="muted">Read-only render of <span className="mono">lib/rubric.ts</span>. The model extracts facts; this code decides.</p></div>
      <Card title="Layer 1 — Hard gates (any fail → DISQUALIFIED)">
        <table className="tbl"><thead><tr><th>Gate</th><th>Fails when</th><th>If still unknown after cap</th></tr></thead><tbody>
          {GATE_IDS.map((g) => <tr key={g}><td><b>{g}</b> {GATES[g].name}</td><td className="mono">{GATES[g].failsWhen}</td><td>{GATES[g].ifUnknown}</td></tr>)}
        </tbody></table>
        <p className="mt-2 text-xs text-slate-500">“SOC 2 in progress” is not certified — it fires T2.</p>
      </Card>
      <Card title="Layers 2 & 3 — Timing and fit signals">
        <table className="tbl"><thead><tr><th>Signal</th><th>Layer</th><th>Points</th><th>Fires when</th></tr></thead><tbody>
          {SIGNAL_IDS.map((s) => <tr key={s}><td><b>{s}</b> {SIGNALS[s].name}</td><td>{SIGNALS[s].layer}</td><td>+{SIGNALS[s].points}</td><td className="mono">{SIGNALS[s].firesWhen}</td></tr>)}
        </tbody></table>
        <p className="mt-2 text-xs text-slate-500">T6 window: {T6_MAX_AGE_DAYS} days.</p>
      </Card>
      <Card title="Verdict">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Any gate fails → <b>DISQUALIFIED</b></li>
          <li>G1 or G2 unknown at cap → <b>INPUT_NEEDED</b></li>
          <li>Gates pass, ≥ 1 timing signal, total ≥ {QUALIFY_MIN_SCORE}, no flags → <b>QUALIFIED</b></li>
          <li>Gates pass, ≥ 1 timing signal, and (total &lt; {QUALIFY_MIN_SCORE} or any flag) → <b>QUALIFIED</b> with flags (still emailed)</li>
          <li>Gates pass, zero timing signals → <b>NURTURE</b> (no email; re-queued later)</li>
          <li>Blocked / failed scrape → <b>UNREACHABLE</b></li>
        </ul>
      </Card>
      <Card title="Qualification loop">
        <p className="text-sm">Homepage first, then at most <b>{config.maxExtraFetches}</b> extra pages (HTTP cap {config.maxHttpRequests}). Priority: {PAGE_PRIORITY.join(" → ")}.</p>
        <table className="tbl mt-2"><thead><tr><th>Requirement</th><th>Pages that can fill it</th></tr></thead><tbody>
          {Object.entries(REQUIREMENT_SOURCES).map(([r, p]) => <tr key={r}><td>{r}</td><td>{p.join(", ")}</td></tr>)}
        </tbody></table>
      </Card>
      <Card title="Decision-maker ranking">
        <table className="tbl"><thead><tr><th>Stage</th><th>Priority</th></tr></thead><tbody>
          <tr><td>Seed / Series A or headcount ≤ {EARLY_MAX_HEADCOUNT}</td><td>{CONTACT_PRIORITY.early.join(" → ")}</td></tr>
          <tr><td>Series B/C+ or headcount &gt; {EARLY_MAX_HEADCOUNT}</td><td>{CONTACT_PRIORITY.growth.join(" → ")}</td></tr>
          <tr><td>Stage unknown</td><td>{CONTACT_PRIORITY.unknown.join(" → ")}</td></tr>
        </tbody></table>
        <table className="tbl mt-2"><thead><tr><th>Tier</th><th>Title pattern</th></tr></thead><tbody>
          {Object.entries(TITLE_TIERS).map(([k, re]) => <tr key={k}><td>{k}</td><td className="mono break-all">{re.source}</td></tr>)}
        </tbody></table>
        <p className="mt-2 text-xs">Never: <span className="mono break-all">{BANNED_TITLE_RE.source}</span>; generic inboxes {GENERIC_INBOXES.map((g) => `${g}@`).join(", ")}; Hunter confidence &lt; {HUNTER_MIN_CONFIDENCE}. A “manager” title alone does not qualify.</p>
      </Card>
      <Card title="Pain point library">
        <table className="tbl"><thead><tr><th>Pain</th><th>Requires signal</th><th>Description</th></tr></thead><tbody>
          {Object.entries(PAIN_LIBRARY).map(([k, p]) => <tr key={k}><td className="mono">{k}</td><td>{p.signals.join(", ")}</td><td>{p.text}</td></tr>)}
        </tbody></table>
      </Card>
      <Card title="Email rules">
        <p className="text-sm">Cold ≤ {EMAIL_LIMITS.COLD_MAX_WORDS} words, follow-up ≤ {EMAIL_LIMITS.FOLLOWUP_MAX_WORDS}, subject ≤ {EMAIL_LIMITS.SUBJECT_MAX_WORDS} words. Only Sprinto claims:</p>
        <ul className="list-disc pl-5 text-sm">{SPRINTO_FACTS.map((f) => <li key={f}>{f}</li>)}</ul>
        <div className="mt-2 flex flex-wrap gap-1">{BANNED_PHRASES.map((b) => <Pill key={b} tone="red">{b}</Pill>)}</div>
      </Card>
    </div>
  );
}
