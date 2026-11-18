/**
 * Runs the real DB-backed pipeline from the terminal (same code as the dashboard's Run loop).
 *   npx tsx scripts/run-queue.ts --dry-run acme.com other.io
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });
import { enqueueDomains, pipelineStep } from "../lib/pipeline/run";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const domains = args.filter((a) => !a.startsWith("--"));
  if (domains.length) console.log("enqueue:", await enqueueDomains(domains, dryRun));
  for (;;) {
    const t0 = Date.now();
    const r = await pipelineStep();
    if (r.done) break;
    console.log(`STEP ${r.domain} → ${r.status} (${((Date.now() - t0) / 1000).toFixed(1)}s, ${r.tokens} tokens, $${r.costUsd})${r.detail ? ` — ${r.detail}` : ""}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
