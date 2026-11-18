import {
  anyGateFailed, chooseNextPage, computeVerdict, sufficiencyCheck, SCRAPE,
  type PageType, type Requirement, type VerdictResult,
} from "../rubric";
import { emptyFacts, mergeFacts, type Extraction, type Facts } from "../facts";
import { discoverLinks, fallbackUrls, type Discovered } from "../scrape/discover";
import { HARD_STOP, type PageResult } from "../scrape/fetch";
import type { Cleaned } from "../scrape/clean";

export interface FetchTrailEntry {
  iteration: number;
  pageType: PageType;
  url: string;
  method: string;
  status: string;
  words: number;
  missingBefore: Requirement[];
  reason: string;
  filled: string[];
  triedUrls?: string[];
}

export interface LoopDeps {
  /** Fetch + clean (+ cache) one URL. */
  fetchPage: (url: string, pageType: PageType) => Promise<PageResult>;
  /** Extract grounded facts from a cleaned page. */
  extract: (url: string, pageType: PageType, cleaned: Cleaned) => Promise<Extraction>;
  maxExtraFetches: number;
  now?: Date;
}

export interface LoopResult {
  outcome: "decided" | "unreachable";
  unreachableReason?: string;
  facts: Facts;
  visited: Set<PageType>;
  available: Set<PageType>;
  trail: FetchTrailEntry[];
  verdict: VerdictResult | null;
  stopReason: string;
  newsFirstScreen?: string;
  homepageUrl: string;
  pageTexts: Record<string, string>;
}

/**
 * The qualification agent loop. CODE decides what is missing and which page to fetch next;
 * the model only extracts facts from each page.
 */
export async function runQualificationLoop(domain: string, deps: LoopDeps): Promise<LoopResult> {
  const now = deps.now ?? new Date();
  let facts = emptyFacts();
  const visited = new Set<PageType>();
  const trail: FetchTrailEntry[] = [];
  const pageTexts: Record<string, string> = {};
  let newsFirstScreen: string | undefined;

  // ── Iteration 0: homepage (try https://domain then https://www.domain)
  const homeCandidates = [`https://${domain}/`, `https://www.${domain}/`];
  let home: PageResult | null = null;
  for (const u of homeCandidates) {
    home = await deps.fetchPage(u, "homepage");
    if (home.status === "ok" || HARD_STOP.includes(home.status) || home.status === "blocked_by_robots") break;
  }
  const homepageUrl = home?.finalUrl ?? homeCandidates[0];
  if (!home || home.status !== "ok" || !home.cleaned) {
    trail.push({ iteration: 0, pageType: "homepage", url: homepageUrl, method: home?.method ?? "fetch", status: home?.status ?? "network_error", words: 0, missingBefore: [], reason: "homepage is always fetched first", filled: [] });
    return { outcome: "unreachable", unreachableReason: `homepage ${home?.status ?? "failed"}${home?.httpStatus ? ` (HTTP ${home.httpStatus})` : ""}`, facts, visited, available: new Set(), trail, verdict: null, stopReason: "homepage unreachable", homepageUrl, pageTexts };
  }
  visited.add("homepage");
  const hx = await deps.extract(homepageUrl, "homepage", home.cleaned);
  const m0 = mergeFacts(facts, hx);
  facts = m0.facts;
  pageTexts[homepageUrl] = home.cleaned.mainText;
  trail.push({ iteration: 0, pageType: "homepage", url: homepageUrl, method: home.method, status: "ok", words: home.cleaned.wordCount, missingBefore: ["product", "buyer", "certs", "timing", "fit"], reason: "homepage is always fetched first", filled: m0.filled });

  // ── Discover candidate pages from homepage links; fall back to common paths.
  const discovered: Discovered = discoverLinks(home.cleaned.links, homepageUrl);
  const candidates = (t: Exclude<PageType, "homepage">) => {
    const linked = discovered[t]?.map((d) => d.url) ?? [];
    if (t !== "security") return (linked.length ? linked : fallbackUrls(t, homepageUrl)).slice(0, 2);
    // Security: a privacy policy is weak evidence for certifications. Prefer real security/trust pages,
    // then the common paths (/security, /trust), then a trust.<domain> portal, and only then privacy links.
    const strong = linked.filter((u) => /security|trust|compliance/i.test(u));
    const weak = linked.filter((u) => !strong.includes(u));
    const trustSub = `https://trust.${domain}/`;
    return [...new Set([...strong, ...fallbackUrls(t, homepageUrl), trustSub, ...weak])].slice(0, 3);
  };
  // Every type is "available" (linked or via up to 2 fallback paths); types that 404 get marked visited.
  const available = new Set<PageType>(["careers", "security", "news", "pricing", "customers", "about"]);

  let stopReason = "all requirements satisfied";
  let extra = 0;
  for (let iteration = 1; ; iteration++) {
    if (anyGateFailed(facts, visited)) { stopReason = "short-circuit: a hard gate already failed"; break; }
    const missing = sufficiencyCheck(facts, visited, available, now);
    if (missing.length === 0) { stopReason = "all requirements satisfied"; break; }
    if (extra >= deps.maxExtraFetches) { stopReason = `fetch cap reached (${deps.maxExtraFetches} extra pages); deciding with what is known`; break; }
    const next = chooseNextPage(missing, visited, available);
    if (!next) { stopReason = `no remaining page can fill: ${missing.join(", ")}`; break; }
    const type = next.page as Exclude<PageType, "homepage">;
    const how = discovered[type] ? "linked from homepage" : "common path fallback";
    const reason = `missing [${missing.join(", ")}]; ${type} serves [${next.serves.join(", ")}] (${how})`;

    extra++;
    visited.add(type);
    const tried: string[] = [];
    let got: PageResult | null = null;
    for (const url of candidates(type)) {
      tried.push(url);
      const r = await deps.fetchPage(url, type);
      got = r;
      if (r.status === "ok" || HARD_STOP.includes(r.status) || r.status === "request_cap_reached") break;
    }
    if (!got || got.status !== "ok" || !got.cleaned) {
      trail.push({ iteration, pageType: type, url: tried[tried.length - 1] ?? "", method: got?.method ?? "fetch", status: got?.status ?? "not_found", words: 0, missingBefore: missing, reason, filled: [], triedUrls: tried });
      if (got && HARD_STOP.includes(got.status)) { stopReason = `${got.status} on ${type} page — stopped, not bypassed`; break; }
      if (got?.status === "request_cap_reached") { stopReason = "HTTP request cap reached"; break; }
      continue;
    }
    const x = await deps.extract(got.finalUrl, type, got.cleaned);
    const m = mergeFacts(facts, x);
    facts = m.facts;
    pageTexts[got.finalUrl] = got.cleaned.mainText;
    if (type === "news") newsFirstScreen = got.cleaned.mainText.slice(0, SCRAPE.NEWS_FIRST_SCREEN_CHARS);
    trail.push({ iteration, pageType: type, url: got.finalUrl, method: got.method, status: "ok", words: got.cleaned.wordCount, missingBefore: missing, reason, filled: m.filled, triedUrls: tried.length > 1 ? tried : undefined });
  }

  const verdict = computeVerdict(facts, { now, visited, newsFirstScreen });
  return { outcome: "decided", facts, visited, available, trail, verdict, stopReason, newsFirstScreen, homepageUrl, pageTexts };
}
