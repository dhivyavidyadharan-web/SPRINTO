import { PAGE_PATTERNS, PAGE_PRIORITY, type PageType } from "../rubric";

export type Discovered = Partial<Record<Exclude<PageType, "homepage">, { url: string; how: "link" | "fallback_path" }[]>>;

function rootDomain(host: string) {
  return host.replace(/^www\./, "").toLowerCase();
}

/** Classify homepage links into page types (href path or anchor text). Max 2 candidates per type. */
export function discoverLinks(links: { href: string; text: string }[], homepageUrl: string): Discovered {
  const home = new URL(homepageUrl);
  const domain = rootDomain(home.hostname);
  const out: Discovered = {};
  for (const type of PAGE_PRIORITY) {
    const pat = PAGE_PATTERNS[type];
    const found: string[] = [];
    for (const l of links) {
      let u: URL;
      try { u = new URL(l.href); } catch { continue; }
      u.hash = "";
      const host = rootDomain(u.hostname);
      const sameSite = host === domain || host.endsWith(`.${domain}`);
      const external = pat.externalHosts?.test(u.hostname) ?? false;
      if (!sameSite && !external) continue;
      if (u.toString().replace(/\/$/, "") === homepageUrl.replace(/\/$/, "")) continue;
      const path = u.pathname.toLowerCase();
      // Avoid deep article links for most types: prefer section roots (≤ 2 path segments).
      const depth = path.split("/").filter(Boolean).length;
      const trustSub = type === "security" && /^trust\./.test(u.hostname);
      const pathHit = pat.keywords.test(path.split("/").filter(Boolean).slice(0, 2).join("/"));
      const textHit = pat.keywords.test(l.text) && l.text.length < 40;
      if (external || trustSub || ((pathHit || textHit) && depth <= 2)) {
        // Skip legal pages for "security" when a better one exists (privacy policy is weak evidence).
        const s = u.toString();
        if (!found.includes(s)) found.push(s);
      }
    }
    // Ranking: for security prefer trust subdomain / "security" / "trust" over "privacy".
    if (type === "security") found.sort((a, b) => secScore(b) - secScore(a));
    if (found.length) out[type] = found.slice(0, 2).map((url) => ({ url, how: "link" as const }));
  }
  return out;
}

function secScore(u: string) {
  if (/\/\/trust\./.test(u)) return 4;
  if (/trust/.test(u)) return 3;
  if (/security/.test(u)) return 2;
  if (/compliance/.test(u)) return 1;
  return 0;
}

/** Fallback candidate URLs when a type was not linked (tried at most 2 per type). */
export function fallbackUrls(type: Exclude<PageType, "homepage">, homepageUrl: string): string[] {
  const origin = new URL(homepageUrl).origin;
  return PAGE_PATTERNS[type].fallbackPaths.slice(0, 2).map((p) => origin + p);
}
