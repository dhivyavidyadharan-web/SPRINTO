import { z } from "zod";
import { generateJson } from "../llm/gemini";
import { GATES, GATE_IDS, SIGNALS, SIGNAL_IDS } from "../rubric";
import type { Company } from "../db/schema";
import type { DecisionLog } from "../pipeline/decisionLog";

const ReviewSchema = z.object({
  verdictSupported: z.boolean(),
  issues: z.array(z.string()),
  recommendation: z.enum(["keep", "re_research"]),
  summary: z.string(),
});
export type VerdictReview = z.infer<typeof ReviewSchema>;

const SYSTEM = `You audit an automated sales-qualification decision for Sprinto (compliance automation: SOC 2, ISO 27001).
The decision was made by fixed rules from facts quoted off the company's website and news. You do NOT re-decide with your own opinion of the company;
you check whether the EVIDENCE actually supports the verdict, and whether research stopped too early.
Known failure patterns to look for:
- A gate failed on weak or indirect evidence (e.g. "SOC 2" read from a privacy policy, a customer's or partner's certification, a marketing badge for a different product, a cert that is only "in progress").
- G1/G2 decided from a vague homepage line.
- NURTURE because no timing signal fired, but key pages (careers, security/trust, pricing) were never fetched or returned errors / timeouts.
- Evidence quotes that are navigation text or do not say what the note claims.
- Headcount / funding misread (e.g. "1,000 customers" taken as employees).
recommendation = "re_research" only if a concrete issue could plausibly flip the verdict; otherwise "keep". Issues: short, specific, quote the problem. summary: one sentence for a busy Growth Lead.`;

export async function reviewVerdict(c: Company): Promise<VerdictReview> {
  const log = (c.decisionLog ?? {}) as Partial<DecisionLog>;
  const gates = GATE_IDS.map((g) => {
    const r = log.gates?.[g];
    return `${g} ${GATES[g].name}: ${r?.status ?? "?"}${r?.note ? ` (${r.note})` : ""}${r?.evidence ? ` — "${r.evidence}"` : ""}${r?.sourceUrl ? ` [${r.sourceUrl}]` : ""}`;
  }).join("\n");
  const signals = SIGNAL_IDS.filter((s) => log.signals?.[s]?.fired).map((s) => `${s} ${SIGNALS[s].name}: "${log.signals?.[s]?.evidence ?? ""}"`).join("\n") || "(none fired)";
  const trail = (log.fetchTrail ?? []).map((t) => `${t.pageType}: ${t.status} ${t.url} (${t.words} words) — ${t.reason}`).join("\n");
  const news = log.news ? `${log.news.items.filter((i) => i.used).map((i) => `${i.date} ${i.title}`).join("\n") || "(no headlines used)"}` : "(no news check)";
  return generateJson({
    slot: "fast", purpose: "learning:verdict_review", temperature: 0, schema: ReviewSchema, system: SYSTEM,
    prompt: `Company: ${c.name ?? c.domain} (${c.domain})
Verdict: ${c.verdict} (score ${c.score ?? 0}; flags ${c.flags.join(", ") || "none"})
Code rationale: ${log.codeRationale ?? ""}
Why research stopped: ${log.stopReason ?? ""}

GATES:
${gates}

SIGNALS FIRED:
${signals}

PAGES FETCHED:
${trail}

NEWS USED:
${news}`,
  });
}
