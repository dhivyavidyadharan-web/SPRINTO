import { describe, it, expect } from "vitest";
import { parseRss, filterNews, feedUrl, feedUrls, mergeNews, newsAsCleaned, itemForQuote } from "@/lib/scrape/news";
import { quoteIn } from "@/lib/facts";
import { runQualificationLoop } from "@/lib/pipeline/qualify";
import { emptyFacts, type Extraction } from "@/lib/facts";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
<item><title>Acme achieves SOC 2 Type II attestation - TechWire</title><link>https://news.example/1</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><source url="https://techwire.example">TechWire</source></item>
<item><title>Acme achieves SOC 2 Type II attestation - Other Site</title><link>https://news.example/1b</link><pubDate>Mon, 02 Nov 2026 11:00:00 GMT</pubDate><source url="https://o.example">Other Site</source></item>
<item><title>Weather in Springfield today</title><link>https://news.example/2</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Acme raises $5M seed</title><link>https://news.example/3</link><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate></item>
</channel></rss>`;

const NOW = new Date("2026-11-19T00:00:00Z");

describe("news feed", () => {
  it("parses RSS items and strips the ' - Publisher' suffix", () => {
    const items = parseRss(RSS);
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({ title: "Acme achieves SOC 2 Type II attestation", link: "https://news.example/1", publisher: "TechWire", date: "2026-11-02" });
  });

  it("keeps only recent headlines that name the company, de-duplicated", () => {
    const kept = filterNews(parseRss(RSS), "Acme", "acme.io", NOW);
    expect(kept.map((i) => i.link)).toEqual(["https://news.example/1"]); // dup, off-topic and 2024 item dropped
  });

  it("builds a query that pairs the name with business words", () => {
    const [byName, byDomain] = feedUrls("google", "Rize", "rize.io").map(decodeURIComponent);
    expect(byName).toContain('"Rize" (startup OR');
    expect(byName).toContain("when:365d");
    expect(byDomain).toContain('"rize.io"');
    expect(feedUrl("bing", "Rize", "rize.io")).toContain("bing.com/news/search");
  });

  it("maps a quote back to the article it came from", () => {
    const items = filterNews(parseRss(RSS), "Acme", "acme.io", NOW);
    expect(itemForQuote(items, "achieves SOC 2 Type II", quoteIn)?.link).toBe("https://news.example/1");
    expect(newsAsCleaned(items, "Acme").mainText).toContain("2026-11-02 · TechWire · Acme achieves SOC 2");
  });
});

describe("qualification loop + news", () => {
  const page = { mainText: "Acme is a B2B SaaS platform for teams", footerText: "", badgeHints: [], links: [], title: "Acme", wordCount: 8 };
  const homeX = (): Extraction => {
    const f = emptyFacts() as unknown as Extraction;
    f.isSoftwareProduct = { value: true, evidence: "B2B SaaS platform", sourceUrl: null };
    f.buyerType = { value: "business", evidence: "for teams", sourceUrl: null };
    return f;
  };

  it("a SOC 2 headline from the news check disqualifies (G3)", async () => {
    const newsX = emptyFacts() as unknown as Extraction;
    newsX.certificationsAchieved = { value: ["SOC 2 Type II"], evidence: "Acme achieves SOC 2 Type II attestation", sourceUrl: "https://news.example/1" };
    const r = await runQualificationLoop("acme.io", {
      maxExtraFetches: 0,
      fetchPage: async (url) => ({ status: "ok", url, finalUrl: url, method: "fetch", cleaned: page } as never),
      extract: async () => homeX(),
      news: async () => ({ result: { source: "google", feedUrl: "f", status: "ok", rawCount: 1, items: [{ title: "Acme achieves SOC 2 Type II attestation", link: "https://news.example/1", publisher: "TechWire", date: "2026-11-02" }] }, extraction: newsX, usedLinks: ["https://news.example/1"] }),
      now: NOW,
    });
    expect(r.verdict?.verdict).toBe("DISQUALIFIED");
    expect(r.verdict?.gates.G3.status).toBe("fail");
    expect(r.news?.items[0].used).toBe(true);
    expect(r.trail.at(-1)?.pageType).toBe("news_feed");
  });

  it("a failing news check never breaks qualification", async () => {
    const r = await runQualificationLoop("acme.io", {
      maxExtraFetches: 0,
      fetchPage: async (url) => ({ status: "ok", url, finalUrl: url, method: "fetch", cleaned: page } as never),
      extract: async () => homeX(),
      news: async () => { throw new Error("feed down"); },
      now: NOW,
    });
    expect(r.outcome).toBe("decided");
    expect(r.verdict).not.toBeNull();
  });
});

describe("news ranking", () => {
  it("puts domain matches first and drops name-only headlines that aren't company news", () => {
    const byName = [
      { title: "AI is exponential and we are linear thinkers", link: "a", publisher: null, date: "2026-11-17" },
      { title: "Linear raises $82M Series C", link: "b", publisher: null, date: "2026-06-01" },
    ];
    const byDomain = [{ title: "Why teams moved to linear.app", link: "c", publisher: null, date: "2026-03-01" }];
    expect(mergeNews(byName, byDomain, "Linear", "linear.app", NOW).map((i) => i.link)).toEqual(["c", "b"]);
  });
});
