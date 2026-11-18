import { z } from "zod";
import { generateJson, type TokenMeter } from "../llm/gemini";
import { PAIN_LIBRARY, SIGNALS, type PainId, type SignalId, type VerdictResult } from "../rubric";
import type { Facts } from "../facts";

export interface PainPoint {
  id: PainId;
  label: string;
  framing: string;
  citedSignals: SignalId[];
  evidence: string | null;
  source: "llm" | "fallback";
}

const Schema = z.object({
  painPoints: z.array(z.object({
    id: z.string(),
    customLabel: z.string().nullable(),
    framing: z.string(),
    citedSignals: z.array(z.string()),
    evidence: z.string().nullable(),
  })),
});

/** Pure validation: a pain point survives only if every cited signal fired (and library pains cite one of their own signals). */
export function validatePainPoints(cands: Omit<PainPoint, "source">[], fired: SignalId[]): { valid: Omit<PainPoint, "source">[]; rejected: { id: string; reason: string }[] } {
  const valid: Omit<PainPoint, "source">[] = [];
  const rejected: { id: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const p of cands) {
    if (seen.has(p.id)) { rejected.push({ id: p.id, reason: "duplicate" }); continue; }
    if (!p.citedSignals.length) { rejected.push({ id: p.id, reason: "cites no signal" }); continue; }
    const notFired = p.citedSignals.filter((s) => !fired.includes(s));
    if (notFired.length) { rejected.push({ id: p.id, reason: `cited signal(s) did not fire: ${notFired.join(", ")}` }); continue; }
    if (p.id !== "custom") {
      const lib = PAIN_LIBRARY[p.id as keyof typeof PAIN_LIBRARY];
      if (!lib) { rejected.push({ id: p.id, reason: "not in pain library" }); continue; }
      if (!p.citedSignals.some((s) => (lib.signals as readonly string[]).includes(s))) { rejected.push({ id: p.id, reason: `library pain requires one of ${lib.signals.join("/")}` }); continue; }
    }
    seen.add(p.id);
    valid.push(p);
  }
  return { valid, rejected };
}

/** Deterministic fallback: library pains whose signals fired, in library order. */
export function fallbackPains(v: VerdictResult, exclude: string[]): Omit<PainPoint, "source">[] {
  const out: Omit<PainPoint, "source">[] = [];
  for (const [id, lib] of Object.entries(PAIN_LIBRARY)) {
    if (exclude.includes(id)) continue;
    const cited = (lib.signals as readonly SignalId[]).filter((s) => v.firedSignals.includes(s));
    if (cited.length) out.push({ id: id as PainId, label: lib.text, framing: lib.text, citedSignals: cited, evidence: v.signals[cited[0]].evidence });
  }
  return out;
}

export async function choosePainPoints(args: { domain: string; facts: Facts; verdict: VerdictResult; contactTitle: string; meter?: TokenMeter }): Promise<{ painPoints: PainPoint[]; rejected: { id: string; reason: string }[] }> {
  const { verdict: v } = args;
  const fired = v.firedSignals;
  const lib = Object.entries(PAIN_LIBRARY).map(([id, p]) => `- ${id} (signals ${p.signals.join("/")}): ${p.text}`).join("\n");
  const firedTxt = fired.map((s) => `${s} ${SIGNALS[s].name}${v.signals[s].note ? ` [${v.signals[s].note}]` : ""}: "${v.signals[s].evidence ?? ""}"`).join("\n");
  let rejected: { id: string; reason: string }[] = [];
  let valid: Omit<PainPoint, "source">[] = [];
  try {
    const out = await generateJson({
      slot: "smart", purpose: "pain_points", temperature: 0.3, meter: args.meter, schema: Schema,
      system: `Choose EXACTLY 2 pain points for a cold email from Sprinto (compliance automation). Pick from the library (use its id) or at most one "custom" (id "custom" + customLabel). Each must cite fired signal ids only, quote the evidence verbatim, and be framed for the recipient's role in one sentence.`,
      prompt: `Company: ${args.domain}\nProduct: ${args.facts.productDescription.value ?? "unknown"}\nRecipient title: ${args.contactTitle}\n\nFired signals:\n${firedTxt}\n\nPain library:\n${lib}`,
    });
    const cands = out.painPoints.map((p) => ({
      id: (p.id === "custom" ? "custom" : p.id) as PainId,
      label: p.id === "custom" ? (p.customLabel ?? "custom") : (PAIN_LIBRARY[p.id as keyof typeof PAIN_LIBRARY]?.text ?? p.id),
      framing: p.framing,
      citedSignals: p.citedSignals.filter((s): s is SignalId => /^[TF]\d$/.test(s)) as SignalId[],
      evidence: p.evidence,
    }));
    ({ valid, rejected } = validatePainPoints(cands, fired));
  } catch (e) {
    rejected.push({ id: "llm", reason: `pain point call failed: ${String(e).slice(0, 120)}` });
  }
  const painPoints: PainPoint[] = valid.slice(0, 2).map((p) => ({ ...p, source: "llm" as const }));
  if (painPoints.length < 2) {
    for (const f of fallbackPains(v, painPoints.map((p) => p.id))) {
      if (painPoints.length >= 2) break;
      painPoints.push({ ...f, source: "fallback" });
    }
  }
  return { painPoints, rejected };
}
