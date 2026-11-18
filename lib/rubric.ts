/**
 * Sprinto qualification rubric. Every threshold, list and point value lives here.
 * All functions are pure: the model extracts facts, THIS CODE decides.
 */
import type { Facts, RecentEvent } from "./facts";
import { normalizeText, quoteIn } from "./facts";

// ───────────────────────────── Page discovery / loop ─────────────────────────────
export const PAGE_TYPES = ["homepage", "careers", "security", "news", "pricing", "customers", "about"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** Order in which the qualification loop prefers to fetch extra pages. */
export const PAGE_PRIORITY: Exclude<PageType, "homepage">[] = ["careers", "security", "news", "pricing", "customers", "about"];

export const PAGE_PATTERNS: Record<Exclude<PageType, "homepage">, { keywords: RegExp; externalHosts?: RegExp; fallbackPaths: string[] }> = {
  careers: { keywords: /careers?|jobs|join[- ]?us|\bjoin\b|hiring|work[- ]with[- ]us/i, externalHosts: /greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com/i, fallbackPaths: ["/careers", "/jobs"] },
  security: { keywords: /security|trust|compliance|privacy/i, fallbackPaths: ["/security", "/trust"] },
  pricing: { keywords: /pricing|plans/i, fallbackPaths: ["/pricing", "/plans"] },
  customers: { keywords: /customers|case[- ]studies|stories/i, fallbackPaths: ["/customers", "/case-studies"] },
  about: { keywords: /about|company|team/i, fallbackPaths: ["/about", "/company"] },
  news: { keywords: /blog|news|press|newsroom|announcements|changelog/i, fallbackPaths: ["/blog", "/news"] },
};

export const SCRAPE = {
  MIN_WORDS_BEFORE_JINA: 200,
  TIMEOUT_MS: 10_000,
  DELAY_MIN_MS: 1000,
  DELAY_MAX_MS: 2000,
  MAX_CHARS: 8000,
  MIN_BLOCK_WORDS: 8,
  CACHE_DAYS: 7,
  NEWS_FIRST_SCREEN_CHARS: 2000,
  BADGE_RE: /soc ?2|iso ?27001|gdpr|hipaa|trust|security|vanta|drata|secureframe|sprinto/i,
  NOISE_RE: /nav|menu|footer|cookie|consent|banner|modal|popup|newsletter/i,
};

// ───────────────────────────── Gates ─────────────────────────────
export const GATE_IDS = ["G1", "G2", "G3", "G4", "G5"] as const;
export type GateId = (typeof GATE_IDS)[number];
export type GateStatus = "pass" | "fail" | "unknown";

export const GATES: Record<GateId, { name: string; failsWhen: string; ifUnknown: string }> = {
  G1: { name: "Software product", failsWhen: "isSoftwareProduct === false (agency, services, hardware, marketplace)", ifUnknown: "INPUT_NEEDED (cannot_determine_product)" },
  G2: { name: "B2B buyer", failsWhen: 'buyerType === "consumer"', ifUnknown: "INPUT_NEEDED (cannot_determine_buyer)" },
  G3: { name: "Already certified", failsWhen: "certificationsAchieved includes SOC 2 or ISO 27001", ifUnknown: "treat as not certified, flag cert_status_unverified" },
  G4: { name: "Already on a compliance tool", failsWhen: "complianceToolDetected ∈ {Vanta, Drata, Secureframe, Sprinto}", ifUnknown: "treat as none" },
  G5: { name: "Out of stage/size", failsWhen: 'fundingStage === "Public" or headcountEstimate >= 1000', ifUnknown: "treat as in range, flag stage_unverified" },
};

export const DISQUALIFYING_CERTS = [/soc ?2/i, /iso ?(\/iec ?)?27001/i];
export const MAX_HEADCOUNT = 1000;

// ───────────────────────────── Signals ─────────────────────────────
export const SIGNAL_IDS = ["T1", "T2", "T3", "T4", "T5", "T6", "F1", "F2"] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];
export const TIMING_IDS: SignalId[] = ["T1", "T2", "T3", "T4", "T5", "T6"];

export const SIGNALS: Record<SignalId, { name: string; points: number; firesWhen: string; layer: "timing" | "fit" }> = {
  T1: { name: "Hiring compliance/security/GRC", points: 3, firesWhen: "complianceSecurityRoles non-empty", layer: "timing" },
  T2: { name: "Audit in progress", points: 3, firesWhen: "certificationsInProgress non-empty", layer: "timing" },
  T3: { name: "Enterprise plan", points: 2, firesWhen: "hasEnterprisePlan === true", layer: "timing" },
  T4: { name: "Enterprise or regulated customers", points: 2, firesWhen: "enterpriseOrRegulatedCustomers non-empty OR regulatedVertical === true", layer: "timing" },
  T5: { name: "GDPR/DPA mention, no certification", points: 1, firesWhen: "mentionsGdprOrDpa === true and no certs achieved", layer: "timing" },
  T6: { name: "Recent trigger event", points: 2, firesWhen: "funding / enterprise_launch / expansion / enterprise_customer event within 12 months (or undated on news page's first screen)", layer: "timing" },
  F1: { name: "Series A–C", points: 2, firesWhen: "fundingStage ∈ {Series A, Series B, Series C}", layer: "fit" },
  F2: { name: "Employee size", points: 1, firesWhen: "20 <= headcountEstimate <= 500 OR openRolesCount >= 5", layer: "fit" },
};

export const T6_EVENT_TYPES: RecentEvent["type"][] = ["funding", "enterprise_launch", "expansion", "enterprise_customer"];
export const T6_MAX_AGE_DAYS = 365;
export const F1_STAGES = ["Series A", "Series B", "Series C"];
export const F2_HEADCOUNT_MIN = 20;
export const F2_HEADCOUNT_MAX = 500;
export const F2_MIN_OPEN_ROLES = 5;
export const QUALIFY_MIN_SCORE = 5;

export const FLAGS = {
  CERT_UNVERIFIED: "cert_status_unverified",
  STAGE_UNVERIFIED: "stage_unverified",
  LOW_SCORE: "score_below_threshold",
} as const;

export type Verdict = "QUALIFIED" | "DISQUALIFIED" | "NURTURE" | "INPUT_NEEDED" | "UNREACHABLE";

export interface GateResult { status: GateStatus; evidence: string | null; sourceUrl: string | null; note?: string }
export interface SignalResult { fired: boolean; points: number; evidence: string | null; sourceUrl: string | null; note?: string }

export interface RubricContext {
  now: Date;
  visited: Set<PageType>;
  /** First screen of the news page, for undated events. */
  newsFirstScreen?: string;
}

// ───────────────────────────── Gate evaluation ─────────────────────────────
function hasDisqualifyingCert(certs: string[] | null): string | null {
  for (const c of certs ?? []) if (DISQUALIFYING_CERTS.some((re) => re.test(c))) return c;
  return null;
}

export function evaluateGates(f: Facts, ctx: RubricContext): Record<GateId, GateResult> {
  const g1: GateResult = f.isSoftwareProduct.value === null
    ? { status: "unknown", evidence: null, sourceUrl: null }
    : { status: f.isSoftwareProduct.value ? "pass" : "fail", evidence: f.isSoftwareProduct.evidence, sourceUrl: f.isSoftwareProduct.sourceUrl };

  const g2: GateResult = f.buyerType.value === null
    ? { status: "unknown", evidence: null, sourceUrl: null }
    : { status: f.buyerType.value === "consumer" ? "fail" : "pass", evidence: f.buyerType.evidence, sourceUrl: f.buyerType.sourceUrl, note: `buyerType=${f.buyerType.value}` };

  const cert = hasDisqualifyingCert(f.certificationsAchieved.value);
  const certsChecked = ctx.visited.has("security") || (f.certificationsAchieved.value?.length ?? 0) > 0 || (f.certificationsInProgress.value?.length ?? 0) > 0;
  const g3: GateResult = cert
    ? { status: "fail", evidence: f.certificationsAchieved.evidence, sourceUrl: f.certificationsAchieved.sourceUrl, note: `achieved: ${cert}` }
    : certsChecked
      ? { status: "pass", evidence: f.certificationsAchieved.evidence ?? f.certificationsInProgress.evidence, sourceUrl: f.certificationsAchieved.sourceUrl ?? f.certificationsInProgress.sourceUrl, note: "no SOC 2 / ISO 27001 achieved" }
      : { status: "unknown", evidence: null, sourceUrl: null, note: "security/trust page not checked" };

  const g4: GateResult = f.complianceToolDetected.value
    ? { status: "fail", evidence: f.complianceToolDetected.evidence, sourceUrl: f.complianceToolDetected.sourceUrl, note: `uses ${f.complianceToolDetected.value}` }
    : ctx.visited.has("security")
      ? { status: "pass", evidence: null, sourceUrl: null, note: "no compliance tool detected" }
      : { status: "unknown", evidence: null, sourceUrl: null, note: "treated as none" };

  const isPublic = f.fundingStage.value === "Public";
  const tooBig = f.headcountEstimate.value !== null && f.headcountEstimate.value >= MAX_HEADCOUNT;
  const g5: GateResult = isPublic
    ? { status: "fail", evidence: f.fundingStage.evidence, sourceUrl: f.fundingStage.sourceUrl, note: "public company" }
    : tooBig
      ? { status: "fail", evidence: f.headcountEstimate.evidence, sourceUrl: f.headcountEstimate.sourceUrl, note: `headcount ${f.headcountEstimate.value}` }
      : f.fundingStage.value !== null
        ? { status: "pass", evidence: f.fundingStage.evidence, sourceUrl: f.fundingStage.sourceUrl, note: f.fundingStage.value }
        : f.headcountEstimate.value !== null
          ? { status: "pass", evidence: f.headcountEstimate.evidence, sourceUrl: f.headcountEstimate.sourceUrl, note: `headcount ${f.headcountEstimate.value}` }
          : { status: "unknown", evidence: null, sourceUrl: null, note: "treated as in range" };

  return { G1: g1, G2: g2, G3: g3, G4: g4, G5: g5 };
}

// ───────────────────────────── Signal evaluation ─────────────────────────────
function daysBetween(a: Date, b: Date) {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

export function qualifyingEvent(f: Facts, ctx: RubricContext): RecentEvent | null {
  for (const e of f.recentEvents) {
    if (!T6_EVENT_TYPES.includes(e.type)) continue;
    if (e.date) {
      const d = new Date(e.date);
      if (!isNaN(d.getTime()) && d <= new Date(ctx.now.getTime() + 86_400_000) && daysBetween(ctx.now, d) <= T6_MAX_AGE_DAYS) return e;
    } else if (ctx.newsFirstScreen && quoteIn(e.evidence, ctx.newsFirstScreen)) {
      return e;
    }
  }
  return null;
}

export function evaluateSignals(f: Facts, ctx: RubricContext): Record<SignalId, SignalResult> {
  const mk = (id: SignalId, fired: boolean, evidence: string | null, sourceUrl: string | null, note?: string): SignalResult =>
    ({ fired, points: fired ? SIGNALS[id].points : 0, evidence: fired ? evidence : null, sourceUrl: fired ? sourceUrl : null, note });

  const roles = f.complianceSecurityRoles.value ?? [];
  const inProg = f.certificationsInProgress.value ?? [];
  const customers = f.enterpriseOrRegulatedCustomers.value ?? [];
  const certsAchieved = f.certificationsAchieved.value ?? [];
  const ev = qualifyingEvent(f, ctx);
  const hc = f.headcountEstimate.value;
  const roles5 = (f.openRolesCount.value ?? 0) >= F2_MIN_OPEN_ROLES;
  const hcFits = hc !== null && hc >= F2_HEADCOUNT_MIN && hc <= F2_HEADCOUNT_MAX;

  return {
    T1: mk("T1", roles.length > 0, f.complianceSecurityRoles.evidence, f.complianceSecurityRoles.sourceUrl, roles.join(", ") || undefined),
    T2: mk("T2", inProg.length > 0, f.certificationsInProgress.evidence, f.certificationsInProgress.sourceUrl, inProg.join(", ") || undefined),
    T3: mk("T3", f.hasEnterprisePlan.value === true, f.hasEnterprisePlan.evidence, f.hasEnterprisePlan.sourceUrl),
    T4: customers.length > 0
      ? mk("T4", true, f.enterpriseOrRegulatedCustomers.evidence, f.enterpriseOrRegulatedCustomers.sourceUrl, customers.join(", "))
      : mk("T4", f.regulatedVertical.value === true, f.regulatedVertical.evidence, f.regulatedVertical.sourceUrl, "regulated vertical"),
    T5: mk("T5", f.mentionsGdprOrDpa.value === true && certsAchieved.length === 0, f.mentionsGdprOrDpa.evidence, f.mentionsGdprOrDpa.sourceUrl),
    T6: mk("T6", !!ev, ev?.evidence ?? null, ev?.sourceUrl ?? null, ev ? `${ev.type}: ${ev.headline}${ev.date ? ` (${ev.date})` : ""}` : undefined),
    F1: mk("F1", !!f.fundingStage.value && F1_STAGES.includes(f.fundingStage.value), f.fundingStage.evidence, f.fundingStage.sourceUrl, f.fundingStage.value ?? undefined),
    F2: hcFits
      ? mk("F2", true, f.headcountEstimate.evidence, f.headcountEstimate.sourceUrl, `headcount ${hc}`)
      : mk("F2", roles5, f.openRolesCount.evidence, f.openRolesCount.sourceUrl, roles5 ? `${f.openRolesCount.value} open roles` : undefined),
  };
}

// ───────────────────────────── Verdict ─────────────────────────────
export interface VerdictResult {
  verdict: Verdict;
  score: number;
  flags: string[];
  gates: Record<GateId, GateResult>;
  signals: Record<SignalId, SignalResult>;
  firedSignals: SignalId[];
  inputNeededReason: string | null;
  rationale: string; // deterministic one-line reason produced by code
}

export function computeVerdict(f: Facts, ctx: RubricContext): VerdictResult {
  const gates = evaluateGates(f, ctx);
  const signals = evaluateSignals(f, ctx);
  const firedSignals = SIGNAL_IDS.filter((s) => signals[s].fired);
  const score = firedSignals.reduce((n, s) => n + signals[s].points, 0);
  const base = { gates, signals, firedSignals, score };

  const failed = GATE_IDS.filter((g) => gates[g].status === "fail");
  if (failed.length) {
    return { ...base, verdict: "DISQUALIFIED", flags: [], inputNeededReason: null, rationale: `Gate(s) failed: ${failed.join(", ")}` };
  }
  if (gates.G1.status === "unknown") {
    return { ...base, verdict: "INPUT_NEEDED", flags: [], inputNeededReason: "cannot_determine_product", rationale: "G1 unknown after fetch cap" };
  }
  if (gates.G2.status === "unknown") {
    return { ...base, verdict: "INPUT_NEEDED", flags: [], inputNeededReason: "cannot_determine_buyer", rationale: "G2 unknown after fetch cap" };
  }

  const flags: string[] = [];
  if (gates.G3.status === "unknown") flags.push(FLAGS.CERT_UNVERIFIED);
  if (gates.G5.status === "unknown") flags.push(FLAGS.STAGE_UNVERIFIED);

  const timing = firedSignals.filter((s) => TIMING_IDS.includes(s));
  if (timing.length === 0) {
    return { ...base, verdict: "NURTURE", flags, inputNeededReason: null, rationale: "Gates pass but no timing signal fired" };
  }
  if (score < QUALIFY_MIN_SCORE) flags.push(FLAGS.LOW_SCORE);
  return {
    ...base, verdict: "QUALIFIED", flags, inputNeededReason: null,
    rationale: `Gates pass; timing ${timing.join("+")}; score ${score}${flags.length ? `; flags ${flags.join(", ")}` : ""}`,
  };
}

// ───────────────────────────── Sufficiency (drives the agent loop) ─────────────────────────────
export type Requirement = "product" | "buyer" | "certs" | "timing" | "fit";

/** Which page types can fill each requirement (in priority order). */
export const REQUIREMENT_SOURCES: Record<Requirement, Exclude<PageType, "homepage">[]> = {
  product: ["pricing", "about", "customers"],
  buyer: ["pricing", "customers", "about"],
  certs: ["security"],
  timing: ["careers", "security", "news", "pricing", "customers"],
  fit: ["careers", "about", "news"],
};
export const TIMING_SOURCE_PAGES = REQUIREMENT_SOURCES.timing;

/**
 * Pure: which requirements are still unmet given current facts and pages visited.
 * `available` = page types discovered for this site (unavailable sources count as exhausted).
 */
export function sufficiencyCheck(f: Facts, visited: Set<PageType>, available: Set<PageType>, now = new Date()): Requirement[] {
  const missing: Requirement[] = [];
  const exhausted = (r: Requirement) => REQUIREMENT_SOURCES[r].every((p) => visited.has(p) || !available.has(p));

  if (f.isSoftwareProduct.value === null && !exhausted("product")) missing.push("product");
  if (f.buyerType.value === null && !exhausted("buyer")) missing.push("buyer");

  const certsKnown = visited.has("security") || (f.certificationsAchieved.value?.length ?? 0) > 0 || !!f.complianceToolDetected.value;
  if (!certsKnown && !exhausted("certs")) missing.push("certs");

  const signals = evaluateSignals(f, { now, visited });
  const anyTiming = TIMING_IDS.some((t) => signals[t].fired);
  if (!anyTiming && !exhausted("timing")) missing.push("timing");

  const fitKnown = f.fundingStage.value !== null || f.headcountEstimate.value !== null || f.openRolesCount.value !== null;
  if (!fitKnown && !exhausted("fit")) missing.push("fit");
  return missing;
}

/** Short-circuit: has any gate already definitively failed? */
export function anyGateFailed(f: Facts, visited: Set<PageType>): boolean {
  const g = evaluateGates(f, { now: new Date(), visited });
  return GATE_IDS.some((id) => g[id].status === "fail");
}

/** Pure: pick the next page by global priority among pages that serve a missing requirement. */
export function chooseNextPage(missing: Requirement[], visited: Set<PageType>, available: Set<PageType>): { page: PageType; serves: Requirement[] } | null {
  for (const p of PAGE_PRIORITY) {
    if (visited.has(p) || !available.has(p)) continue;
    const serves = missing.filter((r) => REQUIREMENT_SOURCES[r].includes(p));
    if (serves.length) return { page: p, serves };
  }
  return null;
}

// ───────────────────────────── Contact ranking ─────────────────────────────
export const TITLE_TIERS = {
  SECURITY_LEAD: /\b(ciso|chief (information )?security officer|chief (compliance|trust|risk) officer|(head|director|vp|vice president|lead)\b[^,|]*\b(security|compliance|grc|infosec|information security|trust|risk))\b/i,
  CTO: /\b(cto|chief technology officer|chief technical officer)\b/i,
  FOUNDER_CEO: /\b(ceo|chief executive officer|co-?founder|founder)\b/i,
  ENG_LEAD: /\b(vp|vice president|head|director|svp)\b[^,|]*\b(engineering|technology|platform|infrastructure)\b/i,
  COO: /\b(coo|chief operating officer)\b/i,
} as const;
export type TitleTier = keyof typeof TITLE_TIERS;

export const CONTACT_PRIORITY: Record<"early" | "growth" | "unknown", TitleTier[]> = {
  early: ["CTO", "FOUNDER_CEO", "ENG_LEAD"],
  growth: ["SECURITY_LEAD", "ENG_LEAD", "CTO", "COO"],
  unknown: ["SECURITY_LEAD", "CTO", "FOUNDER_CEO", "ENG_LEAD", "COO"],
};
export const EARLY_STAGES = ["Seed", "Series A"];
export const EARLY_MAX_HEADCOUNT = 50;

export const BANNED_TITLE_RE = /\b(sales|marketing|growth|hr|human resources|people|talent|recruit(er|ing)?|support|customer success|intern|account (executive|manager)|sdr|bdr|business development|partnerships?|community|brand|content|communications|pr)\b/i;
/** C-level / founder titles are exempt from the banned list (e.g. "Co-founder & CEO, Sales-led"). */
export const EXEMPT_TITLE_RE = /\b(ceo|cto|coo|ciso|founder|co-?founder|chief (technology|executive|operating|information security) officer)\b/i;
export const GENERIC_INBOXES = ["info", "hello", "contact", "sales", "support", "team", "admin", "hi", "careers", "jobs", "press", "marketing", "help", "office", "security", "privacy", "billing", "noreply", "no-reply"];
export const HUNTER_MIN_CONFIDENCE = 70;

export interface CandidateContact {
  id?: number;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  linkedinUrl?: string | null;
  source: string;
  confidence?: number | null;
}

export function stageBucket(f: Pick<Facts, "fundingStage" | "headcountEstimate">): "early" | "growth" | "unknown" {
  const st = f.fundingStage.value;
  const hc = f.headcountEstimate.value;
  if ((st && EARLY_STAGES.includes(st)) || (hc !== null && hc <= EARLY_MAX_HEADCOUNT)) return "early";
  if ((st && ["Series B", "Series C", "Series D+"].includes(st)) || (hc !== null && hc > EARLY_MAX_HEADCOUNT)) return "growth";
  return "unknown";
}

export function rejectReason(c: CandidateContact): string | null {
  const local = (c.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (!c.email) return "no email address";
  if (GENERIC_INBOXES.includes(local)) return `generic inbox (${local}@)`;
  if (!c.firstName) return "no first name (cannot personalise)";
  if (c.source === "hunter" && (c.confidence ?? 0) < HUNTER_MIN_CONFIDENCE) return `Hunter confidence ${c.confidence} < ${HUNTER_MIN_CONFIDENCE}`;
  const title = c.title ?? "";
  if (!title) return "no title";
  if (!EXEMPT_TITLE_RE.test(title) && BANNED_TITLE_RE.test(title)) return `banned function in title ("${title}")`;
  return null;
}

export function titleTier(title: string | null): TitleTier | null {
  if (!title) return null;
  for (const t of Object.keys(TITLE_TIERS) as TitleTier[]) if (TITLE_TIERS[t].test(title)) return t;
  return null;
}

export interface RankResult {
  chosen: CandidateContact | null;
  ruleUsed: string;
  rejected: { name: string; title: string | null; reason: string }[];
}

export function rankContacts(cands: CandidateContact[], f: Pick<Facts, "fundingStage" | "headcountEstimate">): RankResult {
  const bucket = stageBucket(f);
  const order = CONTACT_PRIORITY[bucket];
  const rejected: RankResult["rejected"] = [];
  const eligible: { c: CandidateContact; rank: number; tier: TitleTier }[] = [];
  for (const c of cands) {
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "(unnamed)";
    const r = rejectReason(c);
    if (r) { rejected.push({ name, title: c.title, reason: r }); continue; }
    // A title can match several tiers (e.g. "Co-founder & CTO"); use the best-ranked match.
    let best = -1; let bestTier: TitleTier | null = null;
    order.forEach((tier, i) => { if (best === -1 && TITLE_TIERS[tier].test(c.title ?? "")) { best = i; bestTier = tier; } });
    if (best === -1 || !bestTier) {
      rejected.push({ name, title: c.title, reason: `title not in ${bucket}-stage priority list (${order.join(" → ")}); "manager" alone does not qualify` });
      continue;
    }
    eligible.push({ c, rank: best, tier: bestTier });
  }
  eligible.sort((a, b) => a.rank - b.rank || (b.c.confidence ?? 100) - (a.c.confidence ?? 100));
  const win = eligible[0];
  for (const e of eligible.slice(1)) {
    rejected.push({ name: [e.c.firstName, e.c.lastName].filter(Boolean).join(" "), title: e.c.title, reason: `eligible (${e.tier}) but ranked below ${win.tier}` });
  }
  return {
    chosen: win?.c ?? null,
    ruleUsed: win ? `${bucket}-stage priority ${order.join(" → ")}; matched ${win.tier} (rank ${win.rank + 1})` : `no eligible contact for ${bucket}-stage priority ${order.join(" → ")}`,
    rejected,
  };
}

// ───────────────────────────── Pain points ─────────────────────────────
export const PAIN_LIBRARY = {
  deals_blocked_by_security_reviews: { signals: ["T3", "T4", "T6"], text: "Enterprise deals stall on security questionnaires / SOC 2 requests" },
  audit_prep_eats_engineering_time: { signals: ["T2"], text: "Engineers pulled off roadmap to gather audit evidence" },
  first_compliance_hire_overloaded: { signals: ["T1"], text: "New compliance hire facing manual evidence collection alone" },
  multi_framework_sprawl: { signals: ["T5", "T6"], text: "GDPR + SOC 2 + ISO tracked in spreadsheets" },
  regulated_customer_requirements: { signals: ["T4"], text: "Fintech/health customers demand certification before signing" },
  post_funding_scaling_pressure: { signals: ["T6"], text: "New enterprise targets after a raise require certification" },
  continuous_monitoring_gap: { signals: ["T2"], text: "Passing an audit once vs staying compliant" },
} as const satisfies Record<string, { signals: SignalId[]; text: string }>;
export type PainId = keyof typeof PAIN_LIBRARY | "custom";

// ───────────────────────────── Email rules ─────────────────────────────
export const SPRINTO_FACTS = [
  "Sprinto automates SOC 2, ISO 27001, GDPR and other compliance frameworks",
  "Automated evidence collection",
  "Continuous control monitoring",
  "Helps teams get audit-ready faster",
];
/** Names the email may mention without them appearing in prospect facts. */
export const ALLOWED_TERMS = ["Sprinto", "SOC", "SOC 2", "ISO", "ISO 27001", "GDPR", "HIPAA", "GRC", "CTO", "CEO", "CISO", "VP", "SSO", "SAML", "DPA", "SLA", "I", "Hi"];
export const EMAIL_LIMITS = { COLD_MAX_WORDS: 120, FOLLOWUP_MAX_WORDS: 70, SUBJECT_MAX_WORDS: 7, REPLY_MAX_WORDS: 120 };
export const BANNED_PHRASES = [
  "i hope this finds you well", "hope this finds you well", "i came across", "came across", "touch base", "synergy", "synergies",
  "revolutionize", "revolutionise", "game-changer", "game changer", "just bumping", "bumping this", "circling back",
];
export const PLACEHOLDER_RE = /\[|\]|\{\{|\}\}|\bTBD\b|lorem/i;
export const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
export const CTA_DEFAULT = "a 20-minute call next week";

// ───────────────────────────── Feedback ─────────────────────────────
export const FEEDBACK = { MAX_RULES_PER_FEEDBACK: 3 };

export function isTitleCompanyAllowed(word: string): boolean {
  return ALLOWED_TERMS.some((t) => normalizeText(t) === normalizeText(word));
}
