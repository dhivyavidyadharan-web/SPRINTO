import * as cheerio from "cheerio";
import { SCRAPE } from "../rubric";

export interface Cleaned {
  mainText: string;
  footerText: string;
  badgeHints: string[];
  links: { href: string; text: string }[];
  title: string;
  wordCount: number;
}

export function wordCount(s: string) {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Clean an HTML page per the brief's rules (order matters). */
export function cleanHtml(html: string, baseUrl: string): Cleaned {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();

  // Collect links before anything is removed (nav/footer links are needed for discovery).
  const links: { href: string; text: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    try {
      const abs = new URL(href, baseUrl).toString();
      if (!/^https?:/i.test(abs)) return;
      links.push({ href: abs, text: $(el).text().replace(/\s+/g, " ").trim().slice(0, 80) });
    } catch { /* ignore bad hrefs */ }
  });

  // 1. Remove non-content.
  $("script, style, noscript, svg, iframe, template").remove();

  // 2. Capture footer text separately (cert badges & GDPR mentions live there).
  const footerText = $("footer, [role=contentinfo]").map((_, el) => $(el).text()).get().join(" ").replace(/\s+/g, " ").trim().slice(0, 2000);

  // 3. Badge hints: img alt + link text that mention compliance.
  const badgeHints = new Set<string>();
  $("img[alt]").each((_, el) => { const a = ($(el).attr("alt") ?? "").trim(); if (a && SCRAPE.BADGE_RE.test(a)) badgeHints.add(a.slice(0, 120)); });
  for (const l of links) if (l.text && SCRAPE.BADGE_RE.test(l.text)) badgeHints.add(l.text);

  // 4. Remove chrome and noisy containers.
  $("nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo]").remove();
  $("[class], [id]").each((_, el) => {
    const cls = `${$(el).attr("class") ?? ""} ${$(el).attr("id") ?? ""}`;
    // Only strip small-ish containers to avoid deleting the whole page when <body class="has-navbar">.
    if (SCRAPE.NOISE_RE.test(cls) && el.tagName !== "body" && el.tagName !== "main" && $(el).text().length < 4000) $(el).remove();
  });

  // 5. Blocks → drop short, dedupe, collapse whitespace.
  const blocks: string[] = [];
  const seen = new Set<string>();
  $("h1, h2, h3, h4, p, li, td, blockquote, dd, dt, span, div").each((_, el) => {
    const $el = $(el);
    // Leaf-ish elements only: skip containers that have block children (their text is collected via children).
    if (["div", "span"].includes(el.tagName) && $el.children("p, div, li, h1, h2, h3, h4, ul, ol, table, section").length) return;
    const t = $el.text().replace(/\s+/g, " ").trim();
    if (!t) return;
    const isHeading = /^h[1-4]$/.test(el.tagName);
    if (!isHeading && wordCount(t) < SCRAPE.MIN_BLOCK_WORDS) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    // Skip a block entirely contained in the previous one (nested elements).
    const prev = blocks[blocks.length - 1];
    if (prev && prev.includes(t)) return;
    seen.add(key);
    blocks.push(t);
  });

  let mainText = blocks.join("\n");
  if (mainText.length > SCRAPE.MAX_CHARS) mainText = mainText.slice(0, SCRAPE.MAX_CHARS);
  return { mainText, footerText, badgeHints: [...badgeHints].slice(0, 20), links, title, wordCount: wordCount(mainText) };
}

/** Clean Jina Reader markdown output (already readable text). */
export function cleanMarkdown(md: string): Cleaned {
  const links: { href: string; text: string }[] = [];
  for (const m of md.matchAll(/\[([^\]]{0,80})\]\((https?:[^)\s]+)\)/g)) links.push({ text: m[1], href: m[2] });
  const badgeHints = new Set<string>();
  for (const l of links) if (SCRAPE.BADGE_RE.test(l.text)) badgeHints.add(l.text);
  const body = md.replace(/^(Title|URL Source|Published Time|Markdown Content):.*$/gm, "");
  const seen = new Set<string>();
  const blocks = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .split(/\n+/)
    .map((l) => l.replace(/^[#>*\-\s|]+/, "").replace(/\s+/g, " ").trim())
    .filter((l) => {
      if (!l || (wordCount(l) < SCRAPE.MIN_BLOCK_WORDS && !/^#/.test(l))) return false;
      const k = l.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true;
    });
  const mainText = blocks.join("\n").slice(0, SCRAPE.MAX_CHARS);
  const title = /^Title:\s*(.*)$/m.exec(md)?.[1] ?? "";
  return { mainText, footerText: "", badgeHints: [...badgeHints], links, title, wordCount: wordCount(mainText) };
}
