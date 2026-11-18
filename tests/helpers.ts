import { emptyFacts, type Facts } from "@/lib/facts";
import type { PageType } from "@/lib/rubric";

/** Build Facts from plain values; each value gets a synthetic evidence quote. */
export function facts(v: Partial<Record<keyof Facts, unknown>>): Facts {
  const f = emptyFacts() as unknown as Record<string, unknown>;
  for (const [k, val] of Object.entries(v)) {
    if (k === "recentEvents") { f[k] = val; continue; }
    f[k] = { value: val, evidence: `evidence for ${k}: ${JSON.stringify(val)}`, sourceUrl: `https://x.com/${k}` };
  }
  return f as unknown as Facts;
}

export const allPages = new Set<PageType>(["homepage", "careers", "security", "news", "pricing", "customers", "about"]);
export const ctx = (visited: Iterable<PageType> = allPages, extra: { newsFirstScreen?: string } = {}) =>
  ({ now: new Date("2026-11-18T00:00:00Z"), visited: new Set(visited), ...extra });

export const b2bSaas = { isSoftwareProduct: true, buyerType: "business" as const };

const none = { value: null, evidence: null, sourceUrl: null };
export function emptyExtraction() {
  return {
    companyName: none, productDescription: none, isSoftwareProduct: none, buyerType: none,
    certificationsAchieved: none, certificationsInProgress: none, complianceToolDetected: none, fundingStage: none,
    headcountEstimate: none, openRolesCount: none, complianceSecurityRoles: none, hasEnterprisePlan: none,
    enterpriseOrRegulatedCustomers: none, regulatedVertical: none, mentionsGdprOrDpa: none, recentEvents: [],
  };
}
