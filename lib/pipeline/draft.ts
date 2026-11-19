import { z } from "zod";
import { generateJson, type TokenMeter } from "../llm/gemini";
import { config } from "../env";
import { BANNED_PHRASES, CTA_DEFAULT, EMAIL_LIMITS, SIGNALS, SPRINTO_FACTS, type SignalId, type VerdictResult } from "../rubric";
import { allEvidence, type Facts } from "../facts";
import { qualityGate, type GateResult } from "./qualityGate";
import { assembleEmail, normalizeBody } from "../mail/layout";
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
  /** Self-learning A/B arm instruction for this email (cold emails only). */
  experimentInstruction?: string;
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

/** The model writes the parts; code assembles the layout (lib/mail/layout.ts). */
const ColdSchema = z.object({
  subject: z.string(),
  hook: z.string(),
  pain: z.string(),
  value: z.string(),
  cta: z.string(),
  hookSignalId: z.string(),
  hookQuote: z.string(),
  painPointIdsUsed: z.array(z.string()),
  rulesApplied: z.array(z.string()),
});

/** Back-compat: normalise free text into the standard layout. */
export function formatEmailBody(raw: string, senderName: string, senderTitle: string): string {
  return normalizeBody(raw, senderName, senderTitle);
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

const COLD_SYSTEM = `You write short, specific B2B cold emails for Sprinto, the way a thoughtful person would write to a busy executive.
Return the email as SEPARATE PARTS (code adds the greeting "Hi {firstName}," and the sign-off/signature, so do NOT include them):
- subject: <= 7 words, specific to them, no clickbait, no ALL CAPS, no "!".
- hook: ONE sentence. A specific, verifiable observation from the EVIDENCE (e.g. the GRC role they are hiring for, SOC 2 "in progress" on their trust page, SSO/audit logs on their enterprise plan, a recent funding/enterprise launch). Set hookSignalId to that signal id and hookQuote to the exact evidence quote you relied on (verbatim from the evidence list).
- pain: 1-2 sentences connecting the hook to ONE pain point, phrased for the recipient's role. Empathetic, not alarmist.
- value: ONE sentence on how Sprinto helps, using ONLY the SPRINTO FACTS.
- cta: ONE short, low-friction question (${CTA_DEFAULT}).
Tone: warm, direct, respectful of their time. Short sentences. No jargon stacking.
HARD RULES: all parts together <= ${EMAIL_LIMITS.COLD_MAX_WORDS - 12} words. No invented numbers, statistics, customer names or case studies. Do not mention any company or product name that is not in the facts. Never use: ${BANNED_PHRASES.slice(0, 9).map((p) => `"${p}"`).join(", ")}. No emojis, no placeholders or brackets.
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
${ctx.hookSummary}${ctx.experimentInstruction ? `

STYLE EXPERIMENT (follow this exactly; it takes priority over any style rule above, but never over the HARD RULES):
${ctx.experimentInstruction}` : ""}`;
  return draftWithGate(ctx, COLD_SYSTEM, prompt, EMAIL_LIMITS.COLD_MAX_WORDS, true, "draft_cold");
}

export async function draftFollowup(ctx: DraftContext & { followupNumber: 1 | 2; previousSubject: string; previousBody: string; usedHookSignalId: string | null }): Promise<DraftResult> {
  const altSignals = ctx.verdict.firedSignals.filter((s) => s !== ctx.usedHookSignalId);
  const angle = ctx.followupNumber === 1
    ? `Use a NEW angle: the second pain point (${ctx.painPoints[1]?.id ?? "n/a"}: ${ctx.painPoints[1]?.framing ?? ""}) or a different fired signal (${altSignals.join(", ") || "none"}). Never say "just bumping this" or reference the previous email as the main point. One CTA.`
    : `This is the final, short, polite close-the-loop note. Acknowledge timing may be off, leave the door open, one soft CTA. Still reference one specific fired signal as the hook.`;
  const system = `You write a short follow-up (#${ctx.followupNumber}) to a cold email from Sprinto, sent in the same thread. Plain text.
Return SEPARATE PARTS (code adds "Hi {firstName}," and the sign-off/signature; do NOT include them):
hook (one sentence, the new observation), pain (one sentence), value (one sentence, or "" for the final close-the-loop note), cta (one short question).
All parts together <= ${EMAIL_LIMITS.FOLLOWUP_MAX_WORDS - 10} words. ${angle}
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
${ctx.hookSummary}`;
  const r = await draftWithGate(ctx, system, prompt, EMAIL_LIMITS.FOLLOWUP_MAX_WORDS, true, `draft_followup_${ctx.followupNumber}`);
  if (!/^re:/i.test(r.subject)) r.subject = `Re: ${ctx.previousSubject}`;
  return r;
}

async function draftWithGate(ctx: DraftContext, system: string, prompt: string, maxWords: number, requireHook: boolean, purpose: string): Promise<DraftResult> {
  const failures: string[][] = [];
  let lastDraft: (z.infer<typeof ColdSchema> & { body: string }) | null = null;
  let gate: GateResult = { passed: false, failures: [] };
  const evidence = allEvidence(ctx.facts);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const p: string = attempt === 1 ? prompt : `${prompt}\n\nYOUR PREVIOUS DRAFT FAILED THE QUALITY GATE:\n${failures[failures.length - 1].map((f) => `- ${f}`).join("\n")}\n\nPrevious draft:\nSubject: ${lastDraft?.subject}\n${lastDraft?.body}\n\nRewrite it fixing every failure.`;
    const parts: z.infer<typeof ColdSchema> = await generateJson({ slot: "smart", purpose: `${purpose}#${attempt}`, system, prompt: p, schema: ColdSchema, temperature: 0.7, meter: ctx.meter });
    const d = {
      ...parts,
      body: assembleEmail({ firstName: ctx.contact.firstName, paragraphs: [parts.hook, parts.pain, parts.value, parts.cta], senderName: config.senderName, senderTitle: config.senderTitle }),
    };
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
