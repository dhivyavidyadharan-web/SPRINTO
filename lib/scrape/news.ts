/**
 * Company news from a news-search RSS feed (Google News by default, Bing News as fallback).
 *
 * Why: a company's own blog rarely announces "we got SOC 2" or "we raised a Series B" as clearly
 * as the press does, and press items always carry a date (which T6 needs).
 *
 * Safeguards:
 * - Only headlines that contain the company name (or domain) are kept; the extractor then
 *   rejects namesakes ("Rize" the rice-farming startup vs rize.io) using the homepage description.
 * - Items older than NEWS.MAX_AGE_DAYS are dropped; at most NEWS.MAX_ITEMS are sent to the model.
 * - Facts from news must quote a headline verbatim, like every other fact (grounding).
 */
import * as cheerio from "cheerio";
import type { Cleaned } from "./clean";

export const NEWS = { MAX_AGE_DAYS: 365, MAX_ITEMS: 10, TIMEOUT_MS: 8000 };

const BUSINESS_TERMS = `startup OR software OR raises OR funding OR "SOC 2" OR ISO OR compliance OR launches OR AI`;

export type NewsSource = "google" | "bing" | "off";

export interface NewsItem {
  title: string;
  link: string;
  publisher: string | null;
  date: string | null; // YYYY-MM-DD
}

export interface NewsResult {
  source: Exclude<NewsSource, "off">;
  feedUrl: string;
  status: "ok" | "empty" | "error";
  error?: string;
  /** Items returned by the feed before filtering. */
  rawCount: number;
  items: NewsItem[];
}

/**
 * Two searches per source (search engines return nothing for nested OR-groups, so they can't be one query):
 *  1. the name next to a business word, which cuts namesakes ("Rize" the city, "rippling" the verb);
 *  2. the exact domain.
 * The first URL is the one shown in the decision log.
 */
export function feedUrls(source: Exclude<NewsSource, "off">, name: string, domain: string): string[] {
  const queries = [`"${name}" (${BUSINESS_TERMS})`, `"${domain}"`];
  return queries.map((q) => source === "google"
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${NEWS.MAX_AGE_DAYS}d`)}&hl=en-US&gl=US&ceid=US:en`
    : `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`);
}

/** @deprecated kept for callers that want one URL to display. */
export function feedUrl(source: Exclude<NewsSource, "off">, name: string, domain: string): string {
  return feedUrls(source, name, domain)[0];
}

function isoDay(s: string | undefined | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Parse RSS 2.0 items (Google and Bing both use it). Pure. */
export function parseRss(xml: string): NewsItem[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: NewsItem[] = [];
  $("item").each((_, el) => {
    const it = $(el);
    let title = it.find("title").first().text().trim();
    const publisher = it.find("source").first().text().trim() || null;
    // Google appends " - Publisher" to every title; strip it so the headline is clean.
    if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3)).trim();
    const link = it.find("link").first().text().trim();
    if (!title || !link) return;
    out.push({ title, link, publisher, date: isoDay(it.find("pubDate").first().text().trim()) });
  });
  return out;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Keep recent, de-duplicated headlines that actually name the company. Pure. */
export function filterNews(items: NewsItem[], name: string, domain: string, now = new Date()): NewsItem[] {
  const names = [name, domain, domain.split(".")[0]].filter((n) => n && n.length >= 3);
  const re = new RegExp(`\\b(${names.map(escapeRe).join("|")})\\b`, "i");
  const seen = new Set<string>();
  const cutoff = now.getTime() - NEWS.MAX_AGE_DAYS * 86_400_000;
  return items
    .filter((i) => re.test(i.title))
    .filter((i) => !i.date || new Date(i.date).getTime() >= cutoff)
    .filter((i) => {
      const k = i.title.toLowerCase().replace(/\W+/g, " ").trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, NEWS.MAX_ITEMS);
}

/** Render the headlines as one "page" the extractor can read and the grounding check can verify. */
export function newsAsCleaned(items: NewsItem[], name: string): Cleaned {
  const lines = items.map((i, n) => `[${n + 1}] ${i.date ?? "undated"} · ${i.publisher ?? "unknown publisher"} · ${i.title}`);
  const mainText = lines.join("\n");
  return { title: `News headlines mentioning ${name}`, mainText, footerText: "", badgeHints: [], links: [], wordCount: mainText.split(/\s+/).filter(Boolean).length };
}

/** Which item a quote came from (so each fact links to the article, not the search feed). */
export function itemForQuote(items: NewsItem[], quote: string | null | undefined, quoteIn: (q: string, h: string) => boolean): NewsItem | null {
  if (!quote) return null;
  return items.find((i) => quoteIn(quote, i.title)) ?? null;
}

async function fetchFeed(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), NEWS.TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; SprintoOutboundResearchBot/1.0; RSS reader)", Accept: "application/rss+xml, application/xml, text/xml" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

/** A headline found only by name must itself look like company news (the search matched the body, not the title). */
export const BUSINESS_TITLE_RE = /\b(startup|software|saas|platform|raises?|raised|funding|seed|series [a-e]|soc ?2|iso ?27001|compliance|launch(es|ed)?|acquires?|acquired|customers?|secures?|partners? with|expands?|unveils?|valuation|investors?)\b/i;

/** Domain matches first (most precise), then name matches that read like company news. Pure. */
export function mergeNews(byName: NewsItem[], byDomain: NewsItem[], name: string, domain: string, now = new Date()): NewsItem[] {
  const a = filterNews(byDomain, name, domain, now);
  const b = filterNews(byName.filter((i) => BUSINESS_TITLE_RE.test(i.title)), name, domain, now);
  const seen = new Set<string>();
  return [...a, ...b].filter((i) => {
    const k = i.title.toLowerCase().replace(/\W+/g, " ").trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, NEWS.MAX_ITEMS);
}

/** Fetch news for a company; if the preferred feed fails or finds nothing, try the other one. */
export async function fetchCompanyNews(name: string, domain: string, preferred: NewsSource, now = new Date()): Promise<NewsResult | null> {
  if (preferred === "off") return null;
  const order: Exclude<NewsSource, "off">[] = preferred === "bing" ? ["bing", "google"] : ["google", "bing"];
  let last: NewsResult | null = null;
  for (const source of order) {
    const urls = feedUrls(source, name, domain);
    const got = await Promise.allSettled(urls.map((u) => fetchFeed(u)));
    const ok = got.filter((g): g is PromiseFulfilledResult<string> => g.status === "fulfilled");
    if (!ok.length) {
      const err = got.find((g): g is PromiseRejectedResult => g.status === "rejected");
      last = { source, feedUrl: urls[0], status: "error", error: String(err?.reason?.message ?? err?.reason ?? "fetch failed"), rawCount: 0, items: [] };
      continue;
    }
    const [byName, byDomain] = got.map((g) => (g.status === "fulfilled" ? parseRss(g.value) : []));
    const raw = [...byName, ...byDomain];
    const items = mergeNews(byName, byDomain, name, domain, now);
    last = { source, feedUrl: urls[0], status: items.length ? "ok" : "empty", rawCount: raw.length, items };
    if (items.length) return last;
  }
  return last;
}
