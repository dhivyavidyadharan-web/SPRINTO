/**
 * Self-learning loop (DB + LLM side). Pure statistics live in ./stats.ts.
 *
 *  A. Outcome learning  — finds "what works for whom" in reply outcomes, tries each idea as a TRIAL rule
 *                          on ~half of new cold emails, keeps it only if it does at least as well.
 *  B. A/B experiments   — one writing dimension at a time (CTA, subject, length, opener); the winner
 *                          becomes a rule automatically.
 *  C. Self-review       — proposes rubric point changes from reply data, and second-guesses its own
 *                          Disqualified / Nurture verdicts a week later. Both wait for a human yes.
 *
 * Nothing here can change who receives email (LIVE TEST lock is in lib/mail) or edit the rubric
 * without approval.
 */
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { Rule } from "../db/schema";
import { logEvent, type Actor } from "../db/events";
import { getSetting, setSetting } from "../settings";
import { SIGNAL_IDS, getPointOverrides, setPointOverrides, stageBucket, titleTier, type SignalId } from "../rubric";
import type { Facts } from "../facts";
import type { DecisionLog } from "../pipeline/decisionLog";
import { findDuplicate } from "../feedback/rules";
import {
  LEARN, EXPERIMENT_LIBRARY, assignArm, experimentDecision, findPatterns, isSuccess, pointSuggestions, rollbackCheck, trialDecision,
  type Outcome, type Sample,
} from "./stats";
import { reviewVerdict } from "./review";

export const REVIEW = { AFTER_DAYS: 7, PER_RUN: 3 };

// ───────────────────────────── samples ─────────────────────────────
export interface SampleSet { samples: Sample[]; sentAt: Map<number, Date>; pending: number; total: number }

/** Every sent cold email with a known outcome (pending ones are counted, not used). */
export async function loadSamples(now = new Date()): Promise<SampleSet> {
  const rows = await db().select({ e: schema.emails, c: schema.companies }).from(schema.emails)
    .innerJoin(schema.companies, eq(schema.emails.companyId, schema.companies.id))
    .where(and(eq(schema.emails.kind, "cold"), eq(schema.emails.sendStatus, "sent")));
  const outs = rows.length
    ? await db().select().from(schema.hookOutcomes).where(inArray(schema.hookOutcomes.emailId, rows.map((r) => r.e.id))).orderBy(desc(schema.hookOutcomes.id))
    : [];
  const latest = new Map<number, Outcome>();
  for (const o of outs) if (o.emailId && !latest.has(o.emailId)) latest.set(o.emailId, o.outcome as Outcome);

  const samples: Sample[] = []; const sentAt = new Map<number, Date>(); let pending = 0;
  for (const { e, c } of rows) {
    const sent = e.sentAt ?? e.createdAt;
    let outcome = latest.get(e.id);
    if (!outcome && now.getTime() - sent.getTime() > LEARN.NO_REPLY_DAYS * 86_400_000) outcome = "no_reply";
    if (!outcome) { pending++; continue; }
    const log = (c.decisionLog ?? {}) as Partial<DecisionLog>;
    const facts = c.facts as Facts | null;
    const words = e.body.split(/\s+/).filter(Boolean).length;
    sentAt.set(e.id, sent);
    samples.push({
      emailId: e.id,
      success: isSuccess(outcome),
      hook: e.hookSignalId,
      pain: e.painPointIds[0] ?? null,
      length: words <= 90 ? "short" : "long", // ~80 words of content + greeting/sign-off
      role: titleTier(log.contact?.chosen?.title ?? null),
      stage: facts ? stageBucket(facts) : null,
      firedSignals: SIGNAL_IDS.filter((s) => log.signals?.[s]?.fired) as SignalId[],
      trialRuleIds: e.trialRuleIds ?? [],
      variant: (e.variant as Sample["variant"]) ?? null,
    });
  }
  return { samples, sentAt, pending, total: rows.length };
}

// ───────────────────────────── rubric overrides ─────────────────────────────
export async function loadRubricOverrides() {
  try {
    const raw = await getSetting("rubric_overrides");
    setPointOverrides(raw ? JSON.parse(raw) : {});
  } catch { setPointOverrides({}); }
  return getPointOverrides();
}

// ───────────────────────────── per-draft plan ─────────────────────────────
export interface DraftPlan {
  trialRules: Rule[];
  experiment: { experimentId: number; arm: "A" | "B"; instruction: string; dimension: string } | null;
}

/** Which trial rules and which experiment arm this cold email gets. Deterministic per company. */
export async function draftingPlan(companyId: number): Promise<DraftPlan> {
  const trials = await db().select().from(schema.rules).where(eq(schema.rules.status, "trial"));
  const trialRules = trials.filter((r) => (((companyId * 7919 + r.id * 104729) >>> 0) % 100) < LEARN.TRIAL_SHARE * 100);
  const [exp] = await db().select().from(schema.experiments).where(eq(schema.experiments.status, "running")).limit(1);
  const arm = exp ? assignArm(companyId * 31 + exp.id) : null;
  return {
    trialRules,
    experiment: exp && arm ? { experimentId: exp.id, arm, instruction: arm === "A" ? exp.armA : exp.armB, dimension: exp.dimension } : null,
  };
}

// ───────────────────────────── the learning run ─────────────────────────────
export interface LearningSummary {
  ranAt: string;
  data: { sent: number; withOutcome: number; pending: number; successes: number };
  patterns: { key: string; text: string; z: number; lift: number; group: string; rest: string }[];
  trialsStarted: number[];
  promoted: number[];
  retired: { id: number; reason: string }[];
  experiment: { id: number; dimension: string; status: string; reason: string } | null;
  suggestions: number[];
  reviews: { domain: string; result: string }[];
  notes: string[];
}

const fmt = (r: { wins: number; n: number }) => `${r.wins}/${r.n}`;

export async function runLearning(actor: Actor = "learning", now = new Date()): Promise<LearningSummary> {
  await loadRubricOverrides();
  const { samples, sentAt, pending, total } = await loadSamples(now);
  const summary: LearningSummary = {
    ranAt: now.toISOString(),
    data: { sent: total, withOutcome: samples.length, pending, successes: samples.filter((s) => s.success).length },
    patterns: [], trialsStarted: [], promoted: [], retired: [], experiment: null, suggestions: [], reviews: [], notes: [],
  };
  const allRules = await db().select().from(schema.rules);

  // ── A1. Evaluate running trials.
  for (const r of allRules.filter((x) => x.status === "trial")) {
    const v = trialDecision(samples, `R${r.id}`, r.statusChangedAt ?? r.createdAt, sentAt);
    const evidence = { ...(r.evidence as object ?? {}), trial: { ...v, decidedAt: v.decision === "continue" ? null : now.toISOString() } };
    if (v.decision === "continue") { await db().update(schema.rules).set({ evidence }).where(eq(schema.rules.id, r.id)); continue; }
    const status = v.decision === "promote" ? "active" : "retired";
    await db().update(schema.rules).set({ status, statusChangedAt: now, evidence }).where(eq(schema.rules.id, r.id));
    if (status === "active") summary.promoted.push(r.id); else summary.retired.push({ id: r.id, reason: v.reason });
    await logEvent(null, actor, status === "active" ? "learning_rule_promoted" : "learning_rule_dropped", { ruleId: r.id, text: r.text, reason: v.reason });
  }

  // ── A2. Roll back promoted auto rules that made things clearly worse.
  for (const r of allRules.filter((x) => x.status === "active" && x.origin !== "human" && x.statusChangedAt)) {
    const rb = rollbackCheck(samples, r.statusChangedAt!, sentAt);
    if (!rb.rollback) continue;
    const reason = `rolled back: ${fmt(rb.after)} success since it went live vs ${fmt(rb.before)} before`;
    await db().update(schema.rules).set({ status: "retired", statusChangedAt: now, evidence: { ...(r.evidence as object ?? {}), rollback: { ...rb, at: now.toISOString() } } }).where(eq(schema.rules.id, r.id));
    summary.retired.push({ id: r.id, reason });
    await logEvent(null, actor, "learning_rule_rolled_back", { ruleId: r.id, text: r.text, reason });
  }

  // ── A3. New patterns → trial rules (never re-try a pattern that was already tried).
  const patterns = findPatterns(samples);
  summary.patterns = patterns.slice(0, 10).map((p) => ({ key: p.key, text: p.text, z: p.z, lift: p.lift, group: fmt(p.group), rest: fmt(p.rest) }));
  const tried = new Set(allRules.map((r) => (r.evidence as { patternKey?: string } | null)?.patternKey).filter(Boolean));
  const liveRules = (await db().select().from(schema.rules)).filter((r) => r.status !== "retired");
  let trialCount = liveRules.filter((r) => r.status === "trial").length;
  for (const p of patterns) {
    if (summary.trialsStarted.length >= LEARN.NEW_TRIALS_PER_RUN || trialCount >= LEARN.MAX_TRIALS) break;
    if (tried.has(p.key)) continue;
    if (findDuplicate({ kind: p.kind, text: p.text }, liveRules.map((r) => ({ ...r, status: "active" })))) continue;
    const [row] = await db().insert(schema.rules).values({
      kind: p.kind, text: p.text, origin: "outcome", status: "trial", statusChangedAt: now,
      evidence: { patternKey: p.key, found: { group: p.group, rest: p.rest, z: p.z, lift: p.lift, segment: p.segment, segmentValue: p.segmentValue }, foundAt: now.toISOString() },
    }).returning();
    summary.trialsStarted.push(row.id);
    trialCount++;
    await logEvent(null, actor, "learning_trial_started", { ruleId: row.id, text: p.text, stats: `${fmt(p.group)} vs ${fmt(p.rest)}`, z: p.z });
  }
  if (!patterns.length) summary.notes.push(samples.length < LEARN.MIN_GROUP + LEARN.MIN_REST
    ? `Need at least ${LEARN.MIN_GROUP + LEARN.MIN_REST} cold emails with a known outcome to look for patterns (have ${samples.length}).`
    : "No pattern is strong enough yet to become a trial rule.");

  // ── B. Experiments: evaluate the running one, start the next when none is running.
  summary.experiment = await stepExperiments(samples, actor, now);

  // ── C1. Rubric point suggestions (human approves).
  for (const s of pointSuggestions(samples)) {
    const open = await db().select().from(schema.learningSuggestions).where(and(eq(schema.learningSuggestions.kind, "signal_points"), eq(schema.learningSuggestions.target, s.signal), eq(schema.learningSuggestions.status, "pending")));
    if (open.length) continue;
    const [row] = await db().insert(schema.learningSuggestions).values({
      kind: "signal_points", target: s.signal, current: { points: s.current }, proposed: { points: s.proposed }, rationale: s.rationale,
      evidence: { with: s.with, without: s.without, z: s.z },
    }).returning();
    summary.suggestions.push(row.id);
    await logEvent(null, actor, "learning_rubric_suggestion", { signal: s.signal, from: s.current, to: s.proposed });
  }

  // ── C2. Second opinion on its own Disqualified / Nurture verdicts, a week later.
  summary.reviews = await reviewOldVerdicts(actor, now);

  await setSetting("learning_last_run", JSON.stringify(summary));
  await logEvent(null, actor, "learning_ran", { data: summary.data, trialsStarted: summary.trialsStarted, promoted: summary.promoted, retired: summary.retired, experiment: summary.experiment, suggestions: summary.suggestions, reviews: summary.reviews });
  return summary;
}

async function stepExperiments(samples: Sample[], actor: Actor, now: Date): Promise<LearningSummary["experiment"]> {
  let [exp] = await db().select().from(schema.experiments).where(eq(schema.experiments.status, "running")).limit(1);
  if (exp) {
    const v = experimentDecision(samples, exp.id);
    if (v.decision === "continue") {
      await db().update(schema.experiments).set({ result: v }).where(eq(schema.experiments.id, exp.id));
      return { id: exp.id, dimension: exp.dimension, status: "running", reason: v.reason };
    }
    let winnerRuleId: number | null = null;
    if (v.winner) {
      const text = v.winner === "A" ? exp.armA : exp.armB;
      const [rule] = await db().insert(schema.rules).values({
        kind: "do", text, origin: "experiment", status: "active", statusChangedAt: now,
        evidence: { experimentId: exp.id, dimension: exp.dimension, a: v.a, b: v.b, z: v.z, winner: v.winner },
      }).returning();
      winnerRuleId = rule.id;
    }
    await db().update(schema.experiments).set({ status: "concluded", winner: v.winner ?? "none", result: v, winnerRuleId, concludedAt: now }).where(eq(schema.experiments.id, exp.id));
    await logEvent(null, actor, "learning_experiment_concluded", { experimentId: exp.id, dimension: exp.dimension, winner: v.winner ?? "none", reason: v.reason, winnerRuleId });
  }
  // Start the next untested dimension.
  const done = new Set((await db().select().from(schema.experiments)).map((e) => e.dimension));
  const next = EXPERIMENT_LIBRARY.find((d) => !done.has(d.dimension));
  if (!next) return exp ? { id: exp.id, dimension: exp.dimension, status: "concluded", reason: "all dimensions tested" } : null;
  [exp] = await db().insert(schema.experiments).values({ dimension: next.dimension, armA: next.armA, armB: next.armB, status: "running", startedAt: now }).returning();
  await logEvent(null, actor, "learning_experiment_started", { experimentId: exp.id, dimension: next.dimension });
  return { id: exp.id, dimension: exp.dimension, status: "started", reason: "new experiment: every new cold email is split 50/50 between A and B" };
}

async function reviewOldVerdicts(actor: Actor, now: Date) {
  const cutoff = new Date(now.getTime() - REVIEW.AFTER_DAYS * 86_400_000);
  const reviewed = new Set((await db().select({ id: schema.learningSuggestions.companyId }).from(schema.learningSuggestions).where(eq(schema.learningSuggestions.kind, "verdict_review"))).map((r) => r.id));
  const due = (await db().select().from(schema.companies)
    .where(and(inArray(schema.companies.status, ["DISQUALIFIED", "NURTURE"]), lte(schema.companies.updatedAt, cutoff)))
    .orderBy(schema.companies.updatedAt).limit(20)).filter((c) => !reviewed.has(c.id)).slice(0, REVIEW.PER_RUN);
  const out: { domain: string; result: string }[] = [];
  for (const c of due) {
    try {
      const r = await reviewVerdict(c);
      const questionable = r.recommendation === "re_research";
      await db().insert(schema.learningSuggestions).values({
        kind: "verdict_review", target: c.domain, companyId: c.id, current: { verdict: c.verdict, score: c.score }, proposed: { action: r.recommendation },
        rationale: r.summary, evidence: { issues: r.issues }, status: questionable ? "pending" : "confirmed", decidedAt: questionable ? null : now,
      });
      out.push({ domain: c.domain, result: questionable ? "flagged for re-research" : "verdict confirmed" });
      await logEvent(c.id, actor, questionable ? "learning_verdict_flagged" : "learning_verdict_confirmed", { issues: r.issues, summary: r.summary });
    } catch (e) {
      out.push({ domain: c.domain, result: `review failed: ${String(e).slice(0, 80)}` });
    }
  }
  return out;
}

// ───────────────────────────── human decisions on suggestions ─────────────────────────────
export async function decideSuggestion(id: number, approve: boolean) {
  const [s] = await db().select().from(schema.learningSuggestions).where(eq(schema.learningSuggestions.id, id));
  if (!s) throw new Error("suggestion not found");
  if (s.status !== "pending") throw new Error(`already ${s.status}`);
  if (approve && s.kind === "signal_points") {
    const o = await loadRubricOverrides();
    const points = (s.proposed as { points: number }).points;
    const next = { ...o, [s.target]: points };
    await setSetting("rubric_overrides", JSON.stringify(next));
    setPointOverrides(next);
  }
  if (approve && s.kind === "verdict_review" && s.companyId) {
    await db().update(schema.companies).set({ status: "QUEUED", resumeFrom: null, revisitAfter: null, updatedAt: new Date() }).where(eq(schema.companies.id, s.companyId));
  }
  await db().update(schema.learningSuggestions).set({ status: approve ? "approved" : "rejected", decidedAt: new Date() }).where(eq(schema.learningSuggestions.id, id));
  await logEvent(s.companyId, "human", approve ? "learning_suggestion_approved" : "learning_suggestion_rejected", { id, kind: s.kind, target: s.target });
  return { ok: true };
}

export async function resetRubricOverrides() {
  await setSetting("rubric_overrides", "{}");
  setPointOverrides({});
  await logEvent(null, "human", "rubric_overrides_reset", {});
}

export async function lastLearningRun(): Promise<LearningSummary | null> {
  const raw = await getSetting("learning_last_run");
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Counts for the nav badge: suggestions waiting for a human. */
export async function pendingSuggestionCount() {
  const r = await db().execute(sql`SELECT count(*)::int AS n FROM learning_suggestions WHERE status = 'pending'`);
  return (r.rows[0] as { n: number }).n;
}
