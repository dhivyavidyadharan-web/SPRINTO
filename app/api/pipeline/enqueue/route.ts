import { handler, json } from "@/lib/api";
import { enqueueDomains } from "@/lib/pipeline/run";
import { normalizeDomain } from "@/lib/pipeline/contacts";

export const POST = handler(async (req: Request) => {
  const body = (await req.json()) as { domains?: string[] | string; dryRun?: boolean };
  const raw = Array.isArray(body.domains) ? body.domains : String(body.domains ?? "").split(/[\s,;]+/);
  const domains = [...new Set(raw.map((d) => normalizeDomain(d)).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))];
  if (!domains.length) return json({ error: "no valid domains" }, 400);
  return json(await enqueueDomains(domains, !!body.dryRun));
});
