import robotsParser from "robots-parser";
import { SCRAPE } from "../rubric";
import { config } from "../env";
import { cleanHtml, cleanMarkdown, type Cleaned } from "./clean";

export const USER_AGENT = "SprintoOutboundResearchBot/1.0 (+https://sprinto.com; single-page research fetcher, respects robots.txt)";

export type FetchStatus =
  | "ok" | "blocked_by_robots" | "timeout" | "http_4xx" | "http_5xx" | "bot_challenge" | "login_wall"
  | "captcha" | "empty" | "network_error" | "request_cap_reached" | "not_html";

/** Statuses that mean "stop, do not bypass" for the whole company. */
export const HARD_STOP: FetchStatus[] = ["bot_challenge", "login_wall", "captcha"];

export interface PageResult {
  url: string;
  finalUrl: string;
  method: "fetch" | "jina";
  status: FetchStatus;
  httpStatus?: number;
  cleaned: Cleaned | null;
  note?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One scraper per company: counts HTTP requests, caches robots.txt, rate-limits per host. */
export class Scraper {
  httpRequests = 0;
  private robots = new Map<string, ReturnType<typeof robotsParser> | null>();
  private lastHit = new Map<string, number>();
  constructor(public maxRequests = config.maxHttpRequests) {}

  get capReached() { return this.httpRequests >= this.maxRequests; }

  private async politeDelay(host: string) {
    const last = this.lastHit.get(host);
    if (last) {
      const wait = SCRAPE.DELAY_MIN_MS + Math.random() * (SCRAPE.DELAY_MAX_MS - SCRAPE.DELAY_MIN_MS);
      const elapsed = Date.now() - last;
      if (elapsed < wait) await sleep(wait - elapsed);
    }
    this.lastHit.set(host, Date.now());
  }

  private async rawFetch(url: string, accept = "text/html,application/xhtml+xml"): Promise<Response> {
    this.httpRequests++;
    await this.politeDelay(new URL(url).host);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetch(url, {
          headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "en" },
          redirect: "follow",
          signal: AbortSignal.timeout(SCRAPE.TIMEOUT_MS),
        });
      } catch (e) {
        const isTimeout = (e as Error)?.name === "TimeoutError" || /timeout|aborted/i.test(String(e));
        if (!isTimeout || attempt === 1) throw e;
        // retry once on timeout (counts as another request)
        if (this.capReached) throw e;
        this.httpRequests++;
      }
    }
    throw new Error("unreachable");
  }

  async allowed(url: string): Promise<boolean> {
    const u = new URL(url);
    const key = u.origin;
    if (!this.robots.has(key)) {
      const robotsUrl = `${key}/robots.txt`;
      try {
        if (this.capReached) return true; // cannot check; be conservative below
        const res = await this.rawFetch(robotsUrl, "text/plain");
        const txt = res.ok ? await res.text() : "";
        this.robots.set(key, res.ok ? robotsParser(robotsUrl, txt) : null);
      } catch {
        this.robots.set(key, null);
      }
    }
    const r = this.robots.get(key);
    if (!r) return true; // no robots.txt → allowed
    return r.isAllowed(url, USER_AGENT) !== false;
  }

  async fetchPage(url: string): Promise<PageResult> {
    if (this.capReached) return { url, finalUrl: url, method: "fetch", status: "request_cap_reached", cleaned: null };
    if (!(await this.allowed(url))) return { url, finalUrl: url, method: "fetch", status: "blocked_by_robots", cleaned: null };
    if (this.capReached) return { url, finalUrl: url, method: "fetch", status: "request_cap_reached", cleaned: null };

    let res: Response;
    try {
      res = await this.rawFetch(url);
    } catch (e) {
      const isTimeout = /timeout|aborted/i.test(String(e));
      return { url, finalUrl: url, method: "fetch", status: isTimeout ? "timeout" : "network_error", cleaned: null, note: String(e).slice(0, 200) };
    }
    const finalUrl = res.url || url;
    const body = await res.text().catch(() => "");
    const wall = detectWall(res, body, finalUrl);
    if (wall) return { url, finalUrl, method: "fetch", status: wall, httpStatus: res.status, cleaned: null };
    if (res.status >= 500) return { url, finalUrl, method: "fetch", status: "http_5xx", httpStatus: res.status, cleaned: null };
    if (res.status >= 400) return { url, finalUrl, method: "fetch", status: "http_4xx", httpStatus: res.status, cleaned: null };
    const ctype = res.headers.get("content-type") ?? "";
    if (ctype && !/html|xml|text/i.test(ctype)) return { url, finalUrl, method: "fetch", status: "not_html", httpStatus: res.status, cleaned: null };

    let cleaned = cleanHtml(body, finalUrl);
    let method: "fetch" | "jina" = "fetch";
    if (cleaned.wordCount < SCRAPE.MIN_WORDS_BEFORE_JINA && !this.capReached) {
      const j = await this.fetchJina(finalUrl);
      if (j && j.wordCount > cleaned.wordCount) {
        // keep HTML-derived footer / badges / links, Jina-derived main text
        cleaned = { ...j, footerText: cleaned.footerText || j.footerText, badgeHints: [...new Set([...cleaned.badgeHints, ...j.badgeHints])], links: cleaned.links.length ? cleaned.links : j.links };
        method = "jina";
      }
    }
    if (cleaned.wordCount < 20 && !cleaned.footerText) return { url, finalUrl, method, status: "empty", httpStatus: res.status, cleaned };
    return { url, finalUrl, method, status: "ok", httpStatus: res.status, cleaned };
  }

  private async fetchJina(url: string): Promise<Cleaned | null> {
    try {
      this.httpRequests++;
      const headers: Record<string, string> = { Accept: "text/plain", "X-Return-Format": "markdown" };
      if (config.jinaKey) headers.Authorization = `Bearer ${config.jinaKey}`;
      const res = await fetch(`https://r.jina.ai/${url}`, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const md = await res.text();
      if (/just a moment|cf-chl|captcha/i.test(md.slice(0, 1500))) return null;
      return cleanMarkdown(md);
    } catch {
      return null;
    }
  }
}

export function detectWall(res: Pick<Response, "status" | "headers">, body: string, finalUrl: string): FetchStatus | null {
  const head = body.slice(0, 20000);
  if (/<title>\s*just a moment/i.test(head) || /cf-chl|challenge-platform|cf_chl_opt/i.test(head) || res.headers.get("cf-mitigated") === "challenge") return "bot_challenge";
  if (/g-recaptcha|h-captcha|hcaptcha\.com|captcha-delivery|px-captcha/i.test(head) && (res.status >= 400 || body.length < 15000)) return "captcha";
  if (/\/(login|signin|sign-in|auth)(\/|\?|$)/i.test(new URL(finalUrl).pathname) && /type=["']?password/i.test(head)) return "login_wall";
  return null;
}
