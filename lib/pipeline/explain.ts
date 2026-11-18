import { z } from "zod";
import { generateJson, type TokenMeter } from "../llm/gemini";
import { GATES, SIGNALS, GATE_IDS, SIGNAL_IDS, type VerdictResult } from "../rubric";

const Schema = z.object({ verdictReason: z.string() });

/** The model EXPLAINS the code-computed verdict; it never decides it. */
export async function explainVerdict(domain: string, v: VerdictResult, meter?: TokenMeter): Promise<string> {
  const gates = GATE_IDS.map((g) => `${g} ${GATES[g].name}: ${v.gates[g].status}${v.gates[g].note ? ` (${v.gates[g].note})` : ""}${v.gates[g].evidence ? ` — "${v.gates[g].evidence}"` : ""}`).join("\n");
  const sigs = SIGNAL_IDS.map((s) => `${s} ${SIGNALS[s].name}: ${v.signals[s].fired ? `FIRED +${v.signals[s].points}` : "not fired"}${v.signals[s].evidence ? ` — "${v.signals[s].evidence}"` : ""}`).join("\n");
  try {
    const out = await generateJson({
      slot: "smart", purpose: "verdict_reason", temperature: 0.2, meter, schema: Schema,
      system: "You explain a sales-qualification verdict that has ALREADY been decided by code. Do not change or question the verdict. Write 2-3 sentences. Every claim must cite its signal or gate id in brackets, e.g. [T1] or [G3]. Only use the evidence provided.",
      prompt: `Company: ${domain}\nVerdict (final, decided by code): ${v.verdict}\nScore: ${v.score}\nFlags: ${v.flags.join(", ") || "none"}\nCode rationale: ${v.rationale}\n\nGates:\n${gates}\n\nSignals:\n${sigs}`,
    });
    return out.verdictReason;
  } catch (e) {
    return `${v.rationale}. (LLM explanation unavailable: ${String(e).slice(0, 120)})`;
  }
}
