import { z } from "zod";

/** Every extracted fact carries a verbatim quote and the URL it came from. */
export interface Field<T> {
  value: T | null;
  evidence: string | null;
  sourceUrl: string | null;
  /** Additional supporting quotes gathered when list values were merged across pages. */
  extra?: { evidence: string; sourceUrl: string }[];
}

export const EVENT_TYPES = ["funding", "enterprise_launch", "expansion", "enterprise_customer", "security_incident", "other"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface RecentEvent {
  type: EventType;
  headline: string;
  date: string | null;
  evidence: string;
  sourceUrl: string;
}

export const FUNDING_STAGES = ["Seed", "Series A", "Series B", "Series C", "Series D+", "Public"] as const;
export type FundingStage = (typeof FUNDING_STAGES)[number];
export const COMPLIANCE_TOOLS = ["Vanta", "Drata", "Secureframe", "Sprinto"] as const;

export interface Facts {
  companyName: Field<string>;
  productDescription: Field<string>;
  isSoftwareProduct: Field<boolean>;
  buyerType: Field<"business" | "consumer" | "both">;
  certificationsAchieved: Field<string[]>;
  certificationsInProgress: Field<string[]>;
  complianceToolDetected: Field<(typeof COMPLIANCE_TOOLS)[number]>;
  fundingStage: Field<FundingStage>;
  headcountEstimate: Field<number>;
  openRolesCount: Field<number>;
  complianceSecurityRoles: Field<string[]>;
  hasEnterprisePlan: Field<boolean>;
  enterpriseOrRegulatedCustomers: Field<string[]>;
  regulatedVertical: Field<boolean>;
  mentionsGdprOrDpa: Field<boolean>;
  recentEvents: RecentEvent[];
}

export const SCALAR_KEYS = [
  "companyName", "productDescription", "isSoftwareProduct", "buyerType", "complianceToolDetected",
  "fundingStage", "headcountEstimate", "openRolesCount", "hasEnterprisePlan", "regulatedVertical", "mentionsGdprOrDpa",
] as const;
export const LIST_KEYS = [
  "certificationsAchieved", "certificationsInProgress", "complianceSecurityRoles", "enterpriseOrRegulatedCustomers",
] as const;

function emptyField<T>(): Field<T> {
  return { value: null, evidence: null, sourceUrl: null };
}

export function emptyFacts(): Facts {
  const f: Record<string, unknown> = { recentEvents: [] };
  for (const k of SCALAR_KEYS) f[k] = emptyField();
  for (const k of LIST_KEYS) f[k] = emptyField();
  return f as unknown as Facts;
}

// ---------- Zod schema for one page's extraction (what Gemini returns) ----------
const ev = { evidence: z.string().nullable(), sourceUrl: z.string().nullable() };
const strF = z.object({ value: z.string().nullable(), ...ev });
const boolF = z.object({ value: z.boolean().nullable(), ...ev });
const intF = z.object({ value: z.number().int().nullable(), ...ev });
const listF = z.object({ value: z.array(z.string()).nullable(), ...ev });

export const ExtractionSchema = z.object({
  companyName: strF,
  productDescription: strF,
  isSoftwareProduct: boolF,
  buyerType: z.object({ value: z.enum(["business", "consumer", "both"]).nullable(), ...ev }),
  certificationsAchieved: listF,
  certificationsInProgress: listF,
  complianceToolDetected: z.object({ value: z.enum(COMPLIANCE_TOOLS).nullable(), ...ev }),
  fundingStage: z.object({ value: z.enum(FUNDING_STAGES).nullable(), ...ev }),
  headcountEstimate: intF,
  openRolesCount: intF,
  complianceSecurityRoles: listF,
  hasEnterprisePlan: boolF,
  enterpriseOrRegulatedCustomers: listF,
  regulatedVertical: boolF,
  mentionsGdprOrDpa: boolF,
  recentEvents: z.array(z.object({
    type: z.enum(EVENT_TYPES),
    headline: z.string(),
    date: z.string().nullable(),
    evidence: z.string(),
    sourceUrl: z.string().nullable(),
  })),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[–—-]/g, " ")
    .replace(/[^\p{L}\p{N}%$ ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `quote` appears (normalised) in `haystack`. */
export function quoteIn(quote: string | null | undefined, haystack: string): boolean {
  if (!quote) return false;
  const q = normalizeText(quote);
  if (q.length < 4) return false;
  return normalizeText(haystack).includes(q);
}

/**
 * Sanitise one page's extraction against the page text: a value is only kept when its
 * evidence quote really appears on the page (anti-hallucination). sourceUrl is forced to the page URL.
 */
export function groundExtraction(x: Extraction, pageText: string, url: string): Extraction {
  const out = structuredClone(x) as Extraction;
  const rec = out as unknown as Record<string, { value: unknown; evidence: string | null; sourceUrl: string | null }>;
  for (const k of [...SCALAR_KEYS, ...LIST_KEYS]) {
    const f = rec[k];
    if (!f) continue;
    f.sourceUrl = url;
    const empty = f.value === null || (Array.isArray(f.value) && f.value.length === 0);
    if (empty) { f.value = null; f.evidence = null; continue; }
    if (!quoteIn(f.evidence, pageText)) { f.value = null; f.evidence = null; }
  }
  out.recentEvents = out.recentEvents
    .filter((e) => quoteIn(e.evidence, pageText))
    .map((e) => ({ ...e, sourceUrl: url }));
  return out;
}

/** Merge a (grounded) page extraction into accumulated facts. Returns names of fields newly filled. */
export function mergeFacts(base: Facts, x: Extraction): { facts: Facts; filled: string[] } {
  const facts = structuredClone(base) as Facts;
  const filled: string[] = [];
  const rec = facts as unknown as Record<string, Field<unknown>>;
  const xr = x as unknown as Record<string, { value: unknown; evidence: string | null; sourceUrl: string | null }>;

  for (const k of SCALAR_KEYS) {
    const cur = rec[k];
    const nw = xr[k];
    if (!nw || nw.value === null || nw.value === undefined) continue;
    if (cur.value === null) {
      rec[k] = { value: nw.value, evidence: nw.evidence, sourceUrl: nw.sourceUrl };
      filled.push(k);
    } else if (!cur.evidence && nw.evidence) {
      rec[k] = { value: nw.value, evidence: nw.evidence, sourceUrl: nw.sourceUrl };
    }
  }

  for (const k of LIST_KEYS) {
    const cur = rec[k] as Field<string[]>;
    const nw = xr[k] as { value: string[] | null; evidence: string | null; sourceUrl: string | null };
    if (!nw || !nw.value || nw.value.length === 0) continue;
    const existing = cur.value ?? [];
    const seen = new Set(existing.map((s) => normalizeText(s)));
    const additions = nw.value.filter((v) => v && !seen.has(normalizeText(v)));
    if (cur.value === null) {
      rec[k] = { value: dedupe(nw.value), evidence: nw.evidence, sourceUrl: nw.sourceUrl };
      filled.push(k);
    } else if (additions.length) {
      cur.value = [...existing, ...additions];
      cur.extra = [...(cur.extra ?? []), ...(nw.evidence && nw.sourceUrl ? [{ evidence: nw.evidence, sourceUrl: nw.sourceUrl }] : [])];
    }
  }

  const seenEv = new Set(facts.recentEvents.map((e) => normalizeText(e.headline)));
  for (const e of x.recentEvents) {
    if (seenEv.has(normalizeText(e.headline))) continue;
    facts.recentEvents.push({ ...e, sourceUrl: e.sourceUrl ?? "" });
    seenEv.add(normalizeText(e.headline));
    if (!filled.includes("recentEvents")) filled.push("recentEvents");
  }
  return { facts, filled };
}

function dedupe(arr: string[]) {
  const seen = new Set<string>();
  return arr.filter((s) => { const n = normalizeText(s); if (seen.has(n)) return false; seen.add(n); return true; });
}

/** All verbatim evidence strings stored for a company (used by the email quality gate). */
export function allEvidence(f: Facts): string[] {
  const out: string[] = [];
  const rec = f as unknown as Record<string, Field<unknown>>;
  for (const k of [...SCALAR_KEYS, ...LIST_KEYS]) {
    const fl = rec[k];
    if (fl?.evidence) out.push(fl.evidence);
    for (const e of fl?.extra ?? []) out.push(e.evidence);
  }
  for (const e of f.recentEvents) out.push(e.evidence);
  return out;
}
