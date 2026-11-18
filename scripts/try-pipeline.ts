/**
 * Local, DB-free run of Steps 1–3 (scrape → extract → qualify loop) on real domains.
 *   npm run try -- linear.app vanta.com            (needs GEMINI_API_KEY)
 *   npm run try -- --scrape-only linear.app        (no keys needed: shows fetch/clean/discover)
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { Scraper } from "../lib/scrape/fetch";
import { discoverLinks } from "../lib/scrape/discover";
import { runQualificationLoop } from "../lib/pipeline/qualify";
import { extractFacts } from "../lib/pipeline/extract";
import { TokenMeter } from "../lib/llm/gemini";
import { config } from "../lib/env";

async function main() {
  const args = process.argv.slice(2);
  const scrapeOnly = args.includes("--scrape-only");
  const domains = args.filter((a) => !a.startsWith("--"));
  for (const domain of domains) {
    console.log(`\n════════ ${domain} ════════`);
    const scraper = new Scraper(config.maxHttpRequests);
    if (scrapeOnly) {
      const home = await scraper.fetchPage(`https://${domain}/`);
      console.log({ status: home.status, method: home.method, words: home.cleaned?.wordCount, footer: home.cleaned?.footerText.slice(0, 200), badges: home.cleaned?.badgeHints });
      console.log(home.cleaned?.mainText.slice(0, 800));
      if (home.cleaned) console.log("discovered:", JSON.stringify(discoverLinks(home.cleaned.links, home.finalUrl), null, 1));
      continue;
    }
    const meter = new TokenMeter();
    const res = await runQualificationLoop(domain, {
      maxExtraFetches: config.maxExtraFetches,
      fetchPage: (url) => scraper.fetchPage(url),
      extract: (url, pageType, cleaned) => extractFacts({ url, pageType, cleaned, domain, meter }),
    });
    console.log(JSON.stringify({
      domain, outcome: res.outcome, unreachable: res.unreachableReason, verdict: res.verdict?.verdict, score: res.verdict?.score, flags: res.verdict?.flags,
      rationale: res.verdict?.rationale, stopReason: res.stopReason, httpRequests: scraper.httpRequests,
      gates: res.verdict?.gates, firedSignals: res.verdict && Object.fromEntries(res.verdict.firedSignals.map((s) => [s, res.verdict!.signals[s]])),
      fetchTrail: res.trail, tokens: { in: meter.tokensIn, out: meter.tokensOut, estCostUsd: meter.estCostUsd },
    }, null, 2));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
