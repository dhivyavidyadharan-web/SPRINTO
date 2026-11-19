/**
 * Pure self-learning statistics (unit-tested, no DB, no LLM).
 *
 * The unit of learning is one sent COLD email and what happened afterwards:
 *   success = the prospect replied positively or booked a meeting.
 * Everything here is deliberately conservative: small samples never produce a rule,
 * and every learned change must beat the alternative in a trial before it becomes permanent.
 */
import { SIGNALS, SIGNAL_IDS, signalPoints, MAX_SIGNAL_POINTS, PAIN_LIBRARY, type SignalId } from "../rubric";

export const LEARN = {
  /** A pattern needs at least this many emails in its group before it can become a trial rule. */
  MIN_GROUP: 8,
  /** ...and the rest of the segment must have at least this many. */
  MIN_REST: 5,
  /** Group success rate must be this many times the rest (or 1/this for "avoid" rules). */
  MIN_LIFT: 1.5,
  /** One-sided ~95% confidence. */
  Z: 1.64,
  /** Trial: each arm (with / without the rule) needs this many outcomes before deciding. */
  TRIAL_MIN_PER_ARM: 6,
  /** Trial share: fraction of new cold emails that get a trial rule. */
  TRIAL_SHARE: 0.5,
  MAX_TRIALS: 3,
  NEW_TRIALS_PER_RUN: 1,
  /** A/B experiments. */
  EXP_MIN_PER_ARM: 15,
  EXP_MAX_PER_ARM: 40,
  /** Rubric point suggestions. */
  SIGNAL_MIN: 8,
  /** Emails with no reply after this many days count as "no reply". */
  NO_REPLY_DAYS: 21,
};

export type Outcome = "booked" | "positive" | "negative" | "no_reply";
export const isSuccess = (o: Outcome) => o === "booked" || o === "positive";

/** One sent cold email with a known outcome. */
export interface Sample {
  emailId: number;
  success: boolean;
  /** Levers the drafter controls. */
  hook: string | null;      // signal id used as the opening hook
  pain: string | null;      // first pain point id
  length: "short" | "long"; // <= 80 words = short
  /** Segments the agent can't control but can condition on. */
  role: string | null;      // SECURITY_LEAD | CTO | FOUNDER_CEO | ENG_LEAD | COO
  stage: string | null;     // early | growth | unknown
  firedSignals: SignalId[];
  trialRuleIds: string[];
  variant: { experimentId: number; arm: "A" | "B" } | null;
}

export interface Rate { n: number; wins: number; rate: number }
export function rate(xs: { success: boolean }[]): Rate {
  const wins = xs.filter((x) => x.success).length;
  return { n: xs.length, wins, rate: xs.length ? wins / xs.length : 0 };
}

/** Two-proportion z-score (a vs b). 0 when undefined. */
export function zScore(a: Rate, b: Rate): number {
  if (!a.n || !b.n) return 0;
  const p = (a.wins + b.wins) / (a.n + b.n);
  const se = Math.sqrt(p * (1 - p) * (1 / a.n + 1 / b.n));
  return se === 0 ? 0 : (a.rate - b.rate) / se;
}

// ───────────────────────────── A: patterns → candidate rules ─────────────────────────────
type Lever = "hook" | "pain" | "length";
type Segment = "all" | "role" | "stage";

export interface Pattern {
  key: string;              // stable id, e.g. "stage=early|hook=T1|+"
  direction: "prefer" | "avoid";
  segment: Segment;
  segmentValue: string | null;
  lever: Lever;
  leverValue: string;
  group: Rate;
  rest: Rate;
  z: number;
  lift: number;
  text: string;             // the rule as the drafter will read it
  kind: "do" | "dont";
}

const ROLE_LABEL: Record<string, string> = { SECURITY_LEAD: "security/compliance leads", CTO: "CTOs", FOUNDER_CEO: "founders/CEOs", ENG_LEAD: "engineering leaders", COO: "COOs" };
const STAGE_LABEL: Record<string, string> = { early: "early-stage (Seed/Series A)", growth: "growth-stage (Series B+)", unknown: "unknown-stage" };

function leverPhrase(lever: Lever, v: string): string {
  if (lever === "hook") return `the "${SIGNALS[v as SignalId]?.name ?? v}" observation (${v}) as the opening hook`;
  if (lever === "pain") return `the "${(PAIN_LIBRARY as Record<string, { text: string }>)[v]?.text ?? v}" pain point`;
  return v === "short" ? "a short email (under ~80 words)" : "a fuller email (over ~80 words)";
}

export function patternText(p: Pick<Pattern, "direction" | "segment" | "segmentValue" | "lever" | "leverValue">): string {
  const who = p.segment === "all" ? "" : p.segment === "role" ? `For ${ROLE_LABEL[p.segmentValue ?? ""] ?? p.segmentValue}, ` : `For ${STAGE_LABEL[p.segmentValue ?? ""] ?? p.segmentValue} companies, `;
  const verb = p.direction === "prefer" ? (p.lever === "length" ? "write" : "use") : (p.lever === "length" ? "avoid writing" : "avoid");
  const tail = p.direction === "prefer" ? " when it is available" : " unless nothing else fits";
  const s = `${who}${verb} ${leverPhrase(p.lever, p.leverValue)}${p.lever === "length" ? "" : tail}.`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Find statistically supported "what works for whom" patterns. Pure. */
export function findPatterns(samples: Sample[], cfg = LEARN): Pattern[] {
  const out: Pattern[] = [];
  const segments: { seg: Segment; value: (s: Sample) => string | null }[] = [
    { seg: "all", value: () => "all" },
    { seg: "role", value: (s) => s.role },
    { seg: "stage", value: (s) => s.stage },
  ];
  const levers: Lever[] = ["hook", "pain", "length"];
  for (const { seg, value } of segments) {
    const segValues = [...new Set(samples.map(value).filter((v): v is string => !!v))];
    for (const sv of segValues) {
      const inSeg = samples.filter((s) => value(s) === sv);
      for (const lever of levers) {
        const vals = [...new Set(inSeg.map((s) => s[lever]).filter((v): v is string => !!v))];
        for (const lv of vals) {
          const group = rate(inSeg.filter((s) => s[lever] === lv));
          const rest = rate(inSeg.filter((s) => s[lever] !== lv));
          if (group.n < cfg.MIN_GROUP || rest.n < cfg.MIN_REST) continue;
          const z = zScore(group, rest);
          const lift = rest.rate === 0 ? (group.rate > 0 ? Infinity : 1) : group.rate / rest.rate;
          let direction: Pattern["direction"] | null = null;
          if (z >= cfg.Z && lift >= cfg.MIN_LIFT) direction = "prefer";
          else if (z <= -cfg.Z && (lift <= 1 / cfg.MIN_LIFT)) direction = "avoid";
          if (!direction) continue;
          const base = { direction, segment: seg, segmentValue: seg === "all" ? null : sv, lever, leverValue: lv };
          out.push({
            ...base, group, rest, z: round(z), lift: Number.isFinite(lift) ? round(lift) : 99,
            key: `${seg}=${seg === "all" ? "*" : sv}|${lever}=${lv}|${direction === "prefer" ? "+" : "-"}`,
            text: patternText(base), kind: direction === "prefer" ? "do" : "dont",
          });
        }
      }
    }
  }
  // Strongest evidence first; the most specific segment wins ties.
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z) || (a.segment === "all" ? 1 : 0) - (b.segment === "all" ? 1 : 0));
}

// ───────────────────────────── A: trial rules ─────────────────────────────
export interface TrialVerdict { decision: "promote" | "retire" | "continue"; with: Rate; without: Rate; z: number; reason: string }

/**
 * A trial rule is shown to ~half of new cold emails. Once both halves have enough outcomes,
 * keep it only if emails that saw it did at least as well as those that didn't.
 */
export function trialDecision(samples: Sample[], ruleRef: string, since: Date | null, sentAt: Map<number, Date>, cfg = LEARN): TrialVerdict {
  const inWindow = samples.filter((s) => !since || (sentAt.get(s.emailId) ?? new Date(0)) >= since);
  const w = rate(inWindow.filter((s) => s.trialRuleIds.includes(ruleRef)));
  const wo = rate(inWindow.filter((s) => !s.trialRuleIds.includes(ruleRef)));
  const z = round(zScore(w, wo));
  if (w.n < cfg.TRIAL_MIN_PER_ARM || wo.n < cfg.TRIAL_MIN_PER_ARM) {
    return { decision: "continue", with: w, without: wo, z, reason: `waiting for outcomes (${w.n}/${cfg.TRIAL_MIN_PER_ARM} with, ${wo.n}/${cfg.TRIAL_MIN_PER_ARM} without)` };
  }
  return w.rate >= wo.rate
    ? { decision: "promote", with: w, without: wo, z, reason: `kept: ${pct(w.rate)} success with the rule vs ${pct(wo.rate)} without` }
    : { decision: "retire", with: w, without: wo, z, reason: `dropped: ${pct(w.rate)} success with the rule vs ${pct(wo.rate)} without` };
}

/** Roll back a promoted auto rule if emails since promotion do clearly worse than before it. */
export function rollbackCheck(samples: Sample[], promotedAt: Date, sentAt: Map<number, Date>, cfg = LEARN): { rollback: boolean; before: Rate; after: Rate; z: number } {
  const before = rate(samples.filter((s) => (sentAt.get(s.emailId) ?? new Date(0)) < promotedAt));
  const after = rate(samples.filter((s) => (sentAt.get(s.emailId) ?? new Date(0)) >= promotedAt));
  const z = round(zScore(after, before));
  return { rollback: after.n >= cfg.TRIAL_MIN_PER_ARM * 2 && before.n >= cfg.TRIAL_MIN_PER_ARM && z <= -cfg.Z, before, after, z };
}

// ───────────────────────────── B: A/B experiments ─────────────────────────────
export interface ExperimentDef { dimension: string; label: string; armA: string; armB: string }

/** The writing dimensions the agent tests on itself, in order. */
export const EXPERIMENT_LIBRARY: ExperimentDef[] = [
  { dimension: "cta_style", label: "Call to action", armA: "End with a specific ask: a 20-minute call next week.", armB: "End with a soft interest question (e.g. \"Worth a quick chat?\"), no time commitment." },
  { dimension: "subject_style", label: "Subject line", armA: "Write the subject as a short plain statement about their situation (no question mark).", armB: "Write the subject as a short question about their situation." },
  { dimension: "length", label: "Email length", armA: "Keep all parts together under 60 words. Be brief.", armB: "Use the fuller budget (about 80-95 words) to give one more sentence of context." },
  { dimension: "opener", label: "Opening line", armA: "Open the hook with the specific observation itself.", armB: "Open the hook with the reader's likely goal for their role, then the observation." },
];

/** 50/50, deterministic per email so a retry gets the same arm. */
export function assignArm(seed: number): "A" | "B" {
  let x = (seed * 2654435761) >>> 0;
  x ^= x >>> 16;
  return x % 2 === 0 ? "A" : "B";
}

export interface ExperimentVerdict { decision: "continue" | "winner" | "no_winner"; winner: "A" | "B" | null; a: Rate; b: Rate; z: number; reason: string }

export function experimentDecision(samples: Sample[], experimentId: number, cfg = LEARN): ExperimentVerdict {
  const mine = samples.filter((s) => s.variant?.experimentId === experimentId);
  const a = rate(mine.filter((s) => s.variant?.arm === "A"));
  const b = rate(mine.filter((s) => s.variant?.arm === "B"));
  const z = round(zScore(b, a));
  if (a.n < cfg.EXP_MIN_PER_ARM || b.n < cfg.EXP_MIN_PER_ARM) {
    return { decision: "continue", winner: null, a, b, z, reason: `collecting (${a.n}/${cfg.EXP_MIN_PER_ARM} A, ${b.n}/${cfg.EXP_MIN_PER_ARM} B)` };
  }
  if (Math.abs(z) >= cfg.Z) {
    const winner = z > 0 ? "B" : "A";
    return { decision: "winner", winner, a, b, z, reason: `${winner} wins: ${pct(winner === "A" ? a.rate : b.rate)} vs ${pct(winner === "A" ? b.rate : a.rate)} success (z=${z})` };
  }
  if (a.n >= cfg.EXP_MAX_PER_ARM && b.n >= cfg.EXP_MAX_PER_ARM) {
    return { decision: "no_winner", winner: null, a, b, z, reason: `no clear difference after ${a.n + b.n} emails (${pct(a.rate)} vs ${pct(b.rate)})` };
  }
  return { decision: "continue", winner: null, a, b, z, reason: `no clear difference yet (z=${z}); continuing up to ${cfg.EXP_MAX_PER_ARM} per arm` };
}

// ───────────────────────────── C: rubric point suggestions ─────────────────────────────
export interface PointSuggestion { signal: SignalId; current: number; proposed: number; with: Rate; without: Rate; z: number; rationale: string }

/**
 * Compare qualified-and-emailed companies whose signal fired vs those where it didn't.
 * A signal that predicts replies earns +1; one that predicts silence loses 1. Humans approve.
 */
export function pointSuggestions(samples: Sample[], cfg = LEARN): PointSuggestion[] {
  const out: PointSuggestion[] = [];
  for (const s of SIGNAL_IDS) {
    const w = rate(samples.filter((x) => x.firedSignals.includes(s)));
    const wo = rate(samples.filter((x) => !x.firedSignals.includes(s)));
    if (w.n < cfg.SIGNAL_MIN || wo.n < cfg.MIN_REST) continue;
    const z = round(zScore(w, wo));
    const current = signalPoints(s);
    let proposed = current;
    if (z >= cfg.Z && w.rate >= wo.rate * cfg.MIN_LIFT) proposed = Math.min(MAX_SIGNAL_POINTS, current + 1);
    else if (z <= -cfg.Z) proposed = Math.max(0, current - 1);
    if (proposed === current) continue;
    out.push({
      signal: s, current, proposed, with: w, without: wo, z,
      rationale: `${s} ${SIGNALS[s].name}: ${pct(w.rate)} of emailed leads with it replied positively vs ${pct(wo.rate)} without (n=${w.n} vs ${wo.n}). Suggest ${current} → ${proposed} points.`,
    });
  }
  return out;
}

function round(x: number) { return Math.round(x * 100) / 100; }
export function pct(x: number) { return `${Math.round(x * 100)}%`; }
