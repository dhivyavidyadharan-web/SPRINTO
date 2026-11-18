import { z } from "zod";
import { generateJson, type TokenMeter } from "../llm/gemini";
import { config } from "../env";
import { BANNED_PHRASES, CTA_DEFAULT, EMAIL_LIMITS, SIGNALS, SPRINTO_FACTS, type SignalId, type VerdictResult } from "../rubric";
import { allEvidence, type Facts } from "../facts";
import { qualityGate, type GateResult } from "./qualityGate";
import type { PainPoint } from "./painPoints";

export interface ActiveRule { id: number; kind: string; text: string }

export interface DraftContext {
  domain: string;
  companyName: string;
  facts: Facts;
  verdict: VerdictResult;
  contact: { firstName: string; lastName: string | null; title: string };
  painPoints: PainPoint[];
  rules: ActiveRule[];
  hookSummary: string;
  meter?: TokenMeter;
}

export interface DraftResult {
  subject: string;
  body: string;
  hookSignalId: string | null;
  hookQuote: string | null;
  painPointIdsUsed: string[];
  rulesApplied: string[];
  qualityGate: { passed: boolean; attempts: number; failures: string[][] };
}

const ColdSchema = z.object({
  subject: z.string(),
  body: z.string(),
  hookSignalId: z.string(),
  hookQuote: z.string(),
  painPointIdsUsed: z.array(z.string()),
  rulesApplied: z.array(z.string()),
});

/**
 * Deterministic plain-text layout: greeting on its own line, one blank line between paragraphs,
 * signature (name + title) on its own lines at the end. Fixes drafts returned as one run-on line.
 */
export function formatEmailBody(raw: string, senderName: string, senderTitle: string): string {
  let b = raw.replace(/\r\n/g, "\n").trim();
  // Strip any signature the model wrote (we re-add it), wherever it ended up.
  for (const s of [senderTitle, senderName]) {
    const re = new RegExp(`[\\s,]*${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
    b = b.replace(re, "").trim();
  }
  b = b.replace(/[\s,]*(Best|Thanks|Cheers|Regards|Best regards|Kind regards)[,.]?\s*$/i, "").trim();
  // Greeting on its own line.
  const g = /^(Hi [^,\n]+,)\s*/.exec(b);
  let greeting = "";
  if (g) { greeting = g[1]; b = b.slice(g[0].length).trim(); }
  // If the body has no paragraph breaks, put each sentence group on its own paragraph:
  // hook / pain (until "Sprinto") / value / CTA.
  if (!/\n/.test(b)) {
    const sentences = b.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((x) => x.trim()) ?? [b];
    const paras: string[] = [];
    for (const s of sentences) {
      const startNew = paras.length === 0 || /^Sprinto\b/.test(s) || /\?$/.test(s) || /^(Sprinto|Would|Open|Are|Could|Can|Worth|Happy)\b/.test(s);
      if (startNew) paras.push(s); else paras[paras.length - 1] += ` ${s}`;
    }
    b = paras.join("\n\n");
  } else {
    b = b.replace(/\n{3,}/g, "\n\n");
  }
  return `${greeting ? `${greeting}\n\n` : ""}${b}\n\n${senderName}\n${senderTitle}`;
}

export function signature() {
  return `${config.senderName}\n${config.senderTitle}`;
}

function rulesBlock(rules: ActiveRule[]) {
  if (!rules.length) return "(no feedback rules yet)";
  return rules.map((r) => `R${r.id} [${r.kind.toUpperCase()}]: ${r.text}`).join("\n");
}

function evidenceBlock(v: VerdictResult) {
  return v.firedSignals.map((s) => `${s} (${SIGNALS[s].name}${v.signals[s].note ? `: ${v.signals[s].note}` : ""}) — evidence: "${v.signals[s].evidence ?? ""}" (${v.signals[s].sourceUrl ?? ""})`).join("\n");
}

function factsBlock(f: Facts) {
  const lines: string[] = [];
  const add = (k: string, v: unknown) => { if (v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) lines.push(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`); };
  add("Company", f.companyName.value);
  add("Product", f.productDescription.value);
  add("Funding stage", f.fundingStage.value);
  add("Headcount", f.headcountEstimate.value);
  add("Certifications in progress", f.certificationsInProgress.value);
  add("Open compliance/security roles", f.complianceSecurityRoles.value);
  add("Enterprise/regulated customers", f.enterpriseOrRegulatedCustomers.value);
  for (const e of f.recentEvents.slice(0, 3)) lines.push(`Event: ${e.type} — ${e.headline}${e.date ? ` (${e.date})` : ""}`);
  return lines.join("\n");
}

export function allowedSourceText(ctx: Pick<DraftContext, "facts" | "contact" | "companyName" | "domain">) {
  return [
    JSON.stringify(ctx.facts), ...allEvidence(ctx.facts), ctx.contact.firstName, ctx.contact.lastName ?? "", ctx.contact.title,
    ctx.companyName, ctx.domain, config.senderName, config.senderTitle,
  ].join("\n");
}

const COLD_SYSTEM = `You write short, specific B2B cold emails for Sprinto. Plain text only.
STRUCTURE (exactly):
1. Subject: <= 7 words, specific to them, no clickbait, no ALL CAPS, no "!".
2. Greeting line: "Hi {firstName},"
3. Hook (sentence 1): a specific, verifiable observation from the EVIDENCE (e.g. the GRC role they are hiring for, SOC 2 "in progress" on their trust page, SSO/audit logs on their enterprise plan, a recent funding/enterprise launch). Set hookSignalId to that signal id and hookQuote to the exact evidence quote you relied on (copy it verbatim from the evidence list).
4. Pain (1-2 sentences): connect the hook to ONE pain point, phrased for the recipient's role.
5. Value (1 sentence): how Sprinto helps, using ONLY the SPRINTO FACTS.
6. CTA (1 sentence): one low-friction ask (${CTA_DEFAULT}).
7. Signature: the exact signature given.
HARD RULES: body <= ${EMAIL_LIMITS.COLD_MAX_WORDS} words. No invented numbers, statistics, customer names or case studies. Do not mention any company or product name that is not in the facts. Never use: ${BANNED_PHRASES.slice(0, 9).map((p) => `"${p}"`).join(", ")}. No emojis, no placeholders or brackets.
Apply every FEEDBACK RULE that is relevant and list their ids (e.g. "R3") in rulesApplied.`;

export async function draftColdEmail(ctx: DraftContext): Promise<DraftResult> {
  const prompt = `Recipient: ${ctx.contact.firstName} ${ctx.contact.lastName ?? ""}, ${ctx.contact.title} at ${ctx.companyName}
Domain: ${ctx.domain}

FACTS:
${factsBlock(ctx.facts)}

EVIDENCE (fired signals — the only allowed hooks):
${evidenceBlock(ctx.verdict)}

PAIN POINTS (use the first; the second is reserved for a follow-up):
${ctx.painPoints.map((p) => `${p.id}: ${p.framing} (signals ${p.citedSignals.join(", ")})`).join("\n")}

SPRINTO FACTS (only claims allowed about Sprinto):
${SPRINTO_FACTS.map((s) => `- ${s}`).join("\n")}

FEEDBACK RULES (from the Growth Lead — follow them):
${rulesBlock(ctx.rules)}

HOOK PERFORMANCE SO FAR:
${ctx.hookSummary}

SIGNATURE (end the body with exactly this):
${signature()}`;
  return draftWithGate(ctx, COLD_SYSTEM, prompt, EMAIL_LIMITS.COLD_MAX_WORDS, true, "draft_cold");
}

export async function draftFollowup(ctx: DraftContext & { followupNumber: 1 | 2; previousSubject: string; previousBody: string; usedHookSignalId: string | null }): Promise<DraftResult> {
  const altSignals = ctx.verdict.firedSignals.filter((s) => s !== ctx.usedHookSignalId);
  const angle = ctx.followupNumber === 1
    ? `Use a NEW angle: the second pain point (${ctx.painPoints[1]?.id ?? "n/a"}: ${ctx.painPoints[1]?.framing ?? ""}) or a different fired signal (${altSignals.join(", ") || "none"}). Never say "just bumping this" or reference the previous email as the main point. One CTA.`
    : `This is the final, short, polite close-the-loop note. Acknowledge timing may be off, leave the door open, one soft CTA. Still reference one specific fired signal as the hook.`;
  const system = `You write a short follow-up (#${ctx.followupNumber}) to a cold email from Sprinto, sent in the same thread. Plain text.
Start with "Hi {firstName},". Body <= ${EMAIL_LIMITS.FOLLOWUP_MAX_WORDS} words, end with the exact signature. ${angle}
Set hookSignalId + hookQuote (verbatim from the evidence list) for the observation you use. Subject: reuse "Re: <previous subject>".
No invented numbers, names, stats or case studies. Only Sprinto claims from SPRINTO FACTS. Apply relevant FEEDBACK RULES and list their ids in rulesApplied.`;
  const prompt = `Recipient: ${ctx.contact.firstName}, ${ctx.contact.title} at ${ctx.companyName}

PREVIOUS EMAIL:
Subject: ${ctx.previousSubject}
${ctx.previousBody}

EVIDENCE (fired signals):
${evidenceBlock(ctx.verdict)}

PAIN POINTS:
${ctx.painPoints.map((p) => `${p.id}: ${p.framing} (signals ${p.citedSignals.join(", ")})`).join("\n")}

SPRINTO FACTS:
${SPRINTO_FACTS.map((s) => `- ${s}`).join("\n")}

FEEDBACK RULES:
${rulesBlock(ctx.rules)}

HOOK PERFORMANCE SO FAR:
${ctx.hookSummary}

SIGNATURE:
${signature()}`;
  const r = await draftWithGate(ctx, system, prompt, EMAIL_LIMITS.FOLLOWUP_MAX_WORDS, true, `draft_followup_${ctx.followupNumber}`);
  if (!/^re:/i.test(r.subject)) r.subject = `Re: ${ctx.previousSubject}`;
  return r;
}

async function draftWithGate(ctx: DraftContext, system: string, prompt: string, maxWords: number, requireHook: boolean, purpose: string): Promise<DraftResult> {
  const failures: string[][] = [];
  let lastDraft: z.infer<typeof ColdSchema> | null = null;
  let gate: GateResult = { passed: false, failures: [] };
  const evidence = allEvidence(ctx.facts);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const p: string = attempt === 1 ? prompt : `${prompt}\n\nYOUR PREVIOUS DRAFT FAILED THE QUALITY GATE:\n${failures[failures.length - 1].map((f) => `- ${f}`).join("\n")}\n\nPrevious draft:\nSubject: ${lastDraft?.subject}\n${lastDraft?.body}\n\nRewrite it fixing every failure.`;
    const d: z.infer<typeof ColdSchema> = await generateJson({ slot: "smart", purpose: `${purpose}#${attempt}`, system, prompt: p, schema: ColdSchema, temperature: 0.7, meter: ctx.meter });
    d.body = formatEmailBody(d.body, config.senderName, config.senderTitle);
    lastDraft = d;
    gate = qualityGate({
      subject: d.subject, body: d.body, firstName: ctx.contact.firstName, hookSignalId: d.hookSignalId, hookQuote: d.hookQuote,
      firedSignals: ctx.verdict.firedSignals as SignalId[], evidence, allowedSource: allowedSourceText(ctx), maxWords, requireHook,
    });
    if (gate.passed) break;
    failures.push(gate.failures);
  }
  const d = lastDraft!;
  const validRuleIds = new Set(ctx.rules.map((r) => `R${r.id}`));
  return {
    subject: d.subject.trim(),
    body: d.body,
    hookSignalId: d.hookSignalId,
    hookQuote: d.hookQuote,
    painPointIdsUsed: d.painPointIdsUsed,
    rulesApplied: d.rulesApplied.filter((r) => validRuleIds.has(r)),
    qualityGate: { passed: gate.passed, attempts: failures.length + (gate.passed ? 1 : 0), failures },
  };
}
