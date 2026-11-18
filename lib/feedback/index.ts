import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { config } from "../env";
import { generateJson } from "../llm/gemini";
import { SIGNALS, FEEDBACK } from "../rubric";
import { findDuplicate, rulesToRetire, summariseOutcomes, type NewRule } from "./rules";
import { logEvent } from "../db/events";

export async function getActiveRules() {
  return db().select().from(schema.rules).where(eq(schema.rules.status, "active")).orderBy(schema.rules.id);
}

export async function markRulesApplied(ruleRefs: string[]) {
  const ids = ruleRefs.map((r) => parseInt(r.replace(/^R/i, ""), 10)).filter((n) => Number.isFinite(n));
  if (!ids.length) return;
  await db().update(schema.rules).set({ timesApplied: sql`${schema.rules.timesApplied} + 1` }).where(inArray(schema.rules.id, ids));
}

export async function hookSummary(): Promise<string> {
  const rows = await db().select().from(schema.hookOutcomes).orderBy(desc(schema.hookOutcomes.id)).limit(500);
  const names = Object.fromEntries(Object.entries(SIGNALS).map(([k, v]) => [k, v.name]));
  return summariseOutcomes(rows.map((r) => ({ hookSignalId: r.hookSignalId, painPointIds: r.painPointIds, outcome: r.outcome })), names);
}

export async function recordHookOutcome(companyId: number, outcome: "booked" | "positive" | "negative" | "no_reply") {
  const cold = await db().select().from(schema.emails).where(and(eq(schema.emails.companyId, companyId), eq(schema.emails.kind, "cold"))).orderBy(desc(schema.emails.id)).limit(1);
  const e = cold[0];
  await db().insert(schema.hookOutcomes).values({ emailId: e?.id ?? null, companyId, hookSignalId: e?.hookSignalId ?? null, painPointIds: e?.painPointIds ?? [], outcome });
}

const DistilSchema = z.object({
  rules: z.array(z.object({ kind: z.enum(["do", "dont"]), text: z.string(), duplicateOfRuleId: z.number().int().nullable() })),
});

/** Turn one piece of feedback into 0–3 general, reusable rules; merge near-duplicates; enforce the cap. */
export async function distilFeedback(feedbackId: number) {
  const [fb] = await db().select().from(schema.feedback).where(eq(schema.feedback.id, feedbackId));
  if (!fb) throw new Error("feedback not found");
  const [email] = await db().select().from(schema.emails).where(eq(schema.emails.id, fb.emailId));
  const active = await getActiveRules();
  const diff = fb.editedBody && email && fb.editedBody.trim() !== email.body.trim() ? lineDiff(email.body, fb.editedBody) : "(no edit)";

  const out = await generateJson({
    slot: "fast", purpose: "distil_feedback", temperature: 0, schema: DistilSchema,
    system: `You turn a Growth Lead's feedback on a cold email into 0-${FEEDBACK.MAX_RULES_PER_FEEDBACK} short, GENERAL, reusable writing rules for future emails (not specific to this company).
Each rule: kind "do" or "dont", text <= 20 words, imperative (e.g. dont: "Open with a compliment about their product"; do: "Name the exact job posting in the first line").
If a rule means the same as an existing active rule, set duplicateOfRuleId to that rule's id instead of inventing a new one. Return [] if the feedback contains nothing reusable.`,
    prompt: `Verdict: ${fb.verdict}
What's working: ${fb.working || "(blank)"}
What's not working: ${fb.notWorking || "(blank)"}

Original email:
Subject: ${email?.subject}
${email?.body}

Diff (original → edited):
${diff}

Existing active rules:
${active.map((r) => `${r.id}: [${r.kind}] ${r.text}`).join("\n") || "(none)"}`,
  });

  const created: number[] = []; const merged: number[] = [];
  let live = [...active];
  for (const r of out.rules.slice(0, FEEDBACK.MAX_RULES_PER_FEEDBACK)) {
    const cand: NewRule = { kind: r.kind, text: r.text.trim() };
    const dup = findDuplicate(cand, live, r.duplicateOfRuleId ? [r.duplicateOfRuleId] : []);
    if (dup) {
      // merge: keep the existing rule, refresh its text if the new phrasing is more specific (longer)
      if (cand.text.length > dup.text.length && cand.kind === dup.kind) await db().update(schema.rules).set({ text: cand.text }).where(eq(schema.rules.id, dup.id));
      merged.push(dup.id);
      continue;
    }
    const [row] = await db().insert(schema.rules).values({ kind: cand.kind, text: cand.text, sourceFeedbackId: fb.id }).returning();
    created.push(row.id);
    live.push(row);
  }
  live = await getActiveRules();
  const retire = rulesToRetire(live, config.maxActiveRules);
  if (retire.length) await db().update(schema.rules).set({ status: "retired" }).where(inArray(schema.rules.id, retire));
  await logEvent(email?.companyId ?? null, "human", "feedback_distilled", { feedbackId, created, merged, retired: retire });
  return { created, merged, retired: retire };
}

function lineDiff(a: string, b: string) {
  const A = a.split("\n"), B = b.split("\n");
  const removed = A.filter((l) => !B.includes(l)).map((l) => `- ${l}`);
  const added = B.filter((l) => !A.includes(l)).map((l) => `+ ${l}`);
  return [...removed, ...added].join("\n") || "(whitespace only)";
}
