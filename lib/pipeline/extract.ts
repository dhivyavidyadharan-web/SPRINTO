import { generateJson, type TokenMeter } from "../llm/gemini";
import { ExtractionSchema, groundExtraction, type Extraction } from "../facts";
import type { Cleaned } from "../scrape/clean";

const SYSTEM = `You extract structured facts about a company from ONE web page, for a B2B compliance-software sales team.
Rules:
- Never infer or guess. If the text does not state it, value is null. Null is a correct answer.
- Every non-null value MUST have "evidence": a VERBATIM quote (copy-paste, 5-30 words) from the page text that states it. If you cannot quote it, use null.
- "sourceUrl" is the page URL given.
- isSoftwareProduct: true only if the company sells its own software product (SaaS, platform, API, app). false for agencies, consultancies, services firms, hardware makers, marketplaces.
- buyerType: "business" if customers are companies/teams; "consumer" if individuals; "both" if both are clearly stated.
- certificationsAchieved: certifications/attestations the company says it HAS (e.g. "SOC 2 Type II", "ISO 27001", "HIPAA compliant"). Do NOT include ones in progress.
- certificationsInProgress: ones described as in progress / underway / pursuing / coming soon / "currently undergoing".
- complianceToolDetected: only if the page shows Vanta, Drata, Secureframe or Sprinto (e.g. "Powered by Vanta" trust center).
- fundingStage: only if stated (e.g. "raised a $20M Series B" → "Series B"; IPO/listed/NASDAQ → "Public"). Series D or later → "Series D+".
- headcountEstimate: only if a number of employees/team size is stated ("200+ employees" → 200).
- openRolesCount: number of open job listings visible on a careers page (count them if listed).
- complianceSecurityRoles: exact titles of OPEN job postings in compliance, GRC, security, infosec, privacy or trust.
- hasEnterprisePlan: true if the page shows an Enterprise tier, SSO/SAML, audit logs, SLA, or "contact sales" for a plan.
- enterpriseOrRegulatedCustomers: names of large enterprise or regulated (bank, insurer, hospital, government) customers named on the page.
- regulatedVertical: true if the company itself serves fintech, healthcare, HR/payroll, insurance or government data.
- mentionsGdprOrDpa: true if the page mentions GDPR or a Data Processing Agreement/Addendum.
- recentEvents: announcements (funding, enterprise launch, expansion, enterprise customer win, security incident, other) with ISO date if stated (else null) and a verbatim evidence quote.
Return JSON only.`;

export async function extractFacts(args: { url: string; pageType: string; cleaned: Cleaned; domain: string; meter?: TokenMeter }): Promise<Extraction> {
  const { url, pageType, cleaned } = args;
  const text = pageTextForGrounding(cleaned);
  const prompt = `Company domain: ${args.domain}
Page type: ${pageType}
Page URL: ${url}
Page title: ${cleaned.title}

=== MAIN TEXT ===
${cleaned.mainText}

=== FOOTER TEXT ===
${cleaned.footerText || "(none)"}

=== BADGE / LINK HINTS ===
${cleaned.badgeHints.join(" | ") || "(none)"}`;

  const raw = await generateJson({
    slot: "fast", purpose: `extract:${pageType}`, system: SYSTEM, prompt, schema: ExtractionSchema, temperature: 0, meter: args.meter,
  });
  return groundExtraction(raw, text, url);
}

export function pageTextForGrounding(c: Cleaned) {
  return `${c.title}\n${c.mainText}\n${c.footerText}\n${c.badgeHints.join("\n")}`;
}
