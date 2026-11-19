import { generateJson, type TokenMeter } from "../llm/gemini";
import { ExtractionSchema, groundExtraction, quoteIn, SCALAR_KEYS, LIST_KEYS, type Extraction } from "../facts";
import { newsAsCleaned, itemForQuote, type NewsItem } from "../scrape/news";
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
- hasEnterprisePlan: true if the page shows an Enterprise tier/plan, SSO/SAML, audit logs, SLA, or "contact sales" for a plan. A bare navigation link labelled "Enterprise" is NOT enough; quote the plan or feature text.
- enterpriseOrRegulatedCustomers: names of LARGE enterprises (well-known, typically 1000+ employees) or regulated institutions (banks, insurers, hospitals, government) named as customers on the page. Startups, small businesses and individuals do NOT count; when unsure, leave it out.
- Evidence must be a real sentence or phrase from the content, never a run of menu/navigation labels.
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

const NEWS_ADDENDUM = `
This "page" is a list of NEWS HEADLINES from a news search, one per line: [n] date · publisher · headline.
Extra rules for news:
- Several companies can share a name. Use a headline ONLY if it is clearly about the company described below (same product / industry). If unsure, ignore it.
- Evidence must be copied from the HEADLINE text only (not the date or publisher).
- certificationsAchieved: only if a headline says the company achieved/completed/earned a certification or attestation (e.g. "Acme achieves SOC 2 Type II").
- certificationsInProgress: only if a headline says it is pursuing / starting an audit.
- recentEvents: funding rounds, enterprise launches, expansions, big enterprise customer wins, security incidents. Use the line's date as the ISO date.
- fundingStage: only if a headline names the round (e.g. "raises $20M Series B").
- Leave every other field null unless a headline states it.`;

/** Extract facts from news headlines; every fact links to the article it came from. */
export async function extractNewsFacts(args: { items: NewsItem[]; name: string; domain: string; companyContext: string; feedUrl: string; meter?: TokenMeter }): Promise<{ extraction: Extraction; usedLinks: string[] }> {
  const cleaned = newsAsCleaned(args.items, args.name);
  const prompt = `Company domain: ${args.domain}
Company name: ${args.name}
What the company does (from its homepage): ${args.companyContext.slice(0, 600) || "(unknown)"}
Page URL: ${args.feedUrl}

=== NEWS HEADLINES ===
${cleaned.mainText}`;
  const raw = await generateJson({
    slot: "fast", purpose: "extract:news_feed", system: SYSTEM + NEWS_ADDENDUM, prompt, schema: ExtractionSchema, temperature: 0, meter: args.meter,
  });
  // Ground against the headlines only, then point each fact at its article.
  const headlines = args.items.map((i) => i.title).join("\n");
  const x = groundExtraction(raw, headlines, args.feedUrl);
  const used = new Set<string>();
  const rec = x as unknown as Record<string, { evidence: string | null; sourceUrl: string | null }>;
  for (const k of [...SCALAR_KEYS, ...LIST_KEYS]) {
    const f = rec[k];
    const item = f?.evidence ? itemForQuote(args.items, f.evidence, quoteIn) : null;
    if (item) { f.sourceUrl = item.link; used.add(item.link); }
  }
  x.recentEvents = x.recentEvents.map((e) => {
    const item = itemForQuote(args.items, e.evidence, quoteIn);
    if (item) used.add(item.link);
    return { ...e, sourceUrl: item?.link ?? e.sourceUrl, date: e.date ?? item?.date ?? null };
  });
  // Company identity must come from the website, never from a headline.
  x.companyName = { value: null, evidence: null, sourceUrl: null };
  x.productDescription = { value: null, evidence: null, sourceUrl: null };
  x.isSoftwareProduct = { value: null, evidence: null, sourceUrl: null };
  x.buyerType = { value: null, evidence: null, sourceUrl: null };
  return { extraction: x, usedLinks: [...used] };
}
