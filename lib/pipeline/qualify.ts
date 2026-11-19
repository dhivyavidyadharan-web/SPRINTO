import {
  anyGateFailed, chooseNextPage, computeVerdict, sufficiencyCheck, SCRAPE,
  type PageType, type Requirement, type VerdictResult,
} from "../rubric";
import { emptyFacts, mergeFacts, type Extraction, type Facts } from "../facts";
import { discoverLinks, fallbackUrls, type Discovered } from "../scrape/discover";
import { HARD_STOP, type PageResult } from "../scrape/fetch";
import type { Cleaned } from "../scrape/clean";
import type { NewsResult } from "../scrape/news";

export interface FetchTrailEntry {
  iteration: number;
  pageType: PageType | "news_feed";
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
  /** Epoch ms after which no more pages are fetched (decide with what is known). */
  deadline?: number;
  /** Optional: news-feed research, run in parallel with the page loop and merged before the verdict. */
  news?: (companyName: string, companyContext: string) => Promise<NewsStep | null>;
}

export interface NewsStep { result: NewsResult; extraction: Extraction | null; usedLinks: string[] }

/** What the decision log keeps about the news check. */
export interface NewsSummary {
  source: string; feedUrl: string; status: string; error?: string; rawCount: number; filled: string[];
  items: { title: string; link: string; publisher: string | null; date: string | null; used: boolean }[];
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
  news?: NewsSummary;
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

  // ── News feed: start now (needs the company name), merge after the page loop.
  const companyName = facts.companyName.value ?? (home.cleaned.title.split(/[|–—:-]/)[0].trim() || domain.split(".")[0]);
  const newsP = deps.news
    ? deps.news(companyName, [facts.productDescription.value, home.cleaned.title, home.cleaned.mainText.slice(0, 400)].filter(Boolean).join(" — ")).catch(() => null)
    : Promise.resolve(null);

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
    if (deps.deadline && Date.now() > deps.deadline) { stopReason = "time budget reached; deciding with what is known"; break; }
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

  let news: NewsSummary | undefined;
  // Never let the news check push the request past its budget: wait at most until deadline + 8 s.
  const waitMs = Math.max(3000, (deps.deadline ?? Date.now() + 30_000) + 8000 - Date.now());
  const ns = await Promise.race([newsP, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
  if (!ns && deps.news) trail.push({ iteration: trail.length, pageType: "news_feed", url: "", method: "news RSS", status: "timeout", words: 0, missingBefore: [], reason: "news check did not finish within the time budget; decided without it", filled: [] });
  if (ns) {
    let filled: string[] = [];
    if (ns.extraction) {
      const m = mergeFacts(facts, ns.extraction);
      facts = m.facts;
      filled = m.filled;
    }
    const used = new Set(ns.usedLinks);
    news = {
      source: ns.result.source, feedUrl: ns.result.feedUrl, status: ns.result.status, error: ns.result.error, rawCount: ns.result.rawCount, filled,
      items: ns.result.items.map((i) => ({ ...i, used: used.has(i.link) })),
    };
    trail.push({
      iteration: trail.length, pageType: "news_feed", url: ns.result.feedUrl, method: `${ns.result.source} news RSS`,
      status: ns.result.status === "error" ? "network_error" : "ok", words: ns.result.items.length, missingBefore: [],
      reason: `news check: ${ns.result.items.length} headline(s) name the company (of ${ns.result.rawCount} returned); ${ns.usedLinks.length} used as evidence`,
      filled,
    });
  }

  const verdict = computeVerdict(facts, { now, visited, newsFirstScreen });
  return { outcome: "decided", facts, visited, available, trail, verdict, stopReason, newsFirstScreen, homepageUrl, pageTexts, news };
}
