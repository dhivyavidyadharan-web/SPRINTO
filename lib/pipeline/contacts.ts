import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { config } from "../env";
import { rankContacts, type CandidateContact, type RankResult } from "../rubric";
import type { Facts } from "../facts";

export interface ContactProvider {
  name: string;
  find(domain: string): Promise<CandidateContact[]>;
}

/** Contacts uploaded via CSV on the dashboard (looked up manually in Apollo). */
export const dbProvider: ContactProvider = {
  name: "db",
  async find(domain) {
    const rows = await db().select().from(schema.contacts).where(eq(schema.contacts.domain, domain));
    return rows.map((r) => ({ id: r.id, firstName: r.firstName, lastName: r.lastName, title: r.title, email: r.email, linkedinUrl: r.linkedinUrl, source: r.source, confidence: r.confidence }));
  },
};

/** Hunter Domain Search with a permanent Postgres cache (free tier = 25 searches / month). */
export const hunterProvider: ContactProvider = {
  name: "hunter",
  async find(domain) {
    const cached = await db().select().from(schema.hunterCache).where(eq(schema.hunterCache.domain, domain));
    let data: unknown;
    if (cached.length) data = cached[0].response;
    else {
      if (!config.hunterKey) return [];
      const res = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=20&api_key=${config.hunterKey}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Hunter HTTP ${res.status}`);
      data = await res.json();
      await db().insert(schema.hunterCache).values({ domain, response: data as object }).onConflictDoNothing();
    }
    const emails = ((data as { data?: { emails?: unknown[] } })?.data?.emails ?? []) as {
      value: string; first_name: string | null; last_name: string | null; position: string | null; linkedin: string | null; confidence: number;
    }[];
    return emails.map((e) => ({ firstName: e.first_name, lastName: e.last_name, title: e.position, email: e.value, linkedinUrl: e.linkedin, source: "hunter", confidence: e.confidence }));
  },
};

export async function findDecisionMaker(domain: string, facts: Facts): Promise<RankResult & { provider: string; candidatesCount: number }> {
  // DB contacts always count (manual uploads override); Hunter adds more when configured.
  const providers = config.contactSource === "hunter" ? [dbProvider, hunterProvider] : [dbProvider];
  const all: CandidateContact[] = [];
  for (const p of providers) {
    try { all.push(...(await p.find(domain))); } catch (e) { console.error(`[contacts] ${p.name} failed`, e); }
  }
  const r = rankContacts(all, facts);
  return { ...r, provider: providers.map((p) => p.name).join("+"), candidatesCount: all.length };
}

/** Parse the contacts CSV: domain,first_name,last_name,title,email,linkedin_url */
export function parseContactsCsv(csv: string) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (n: string) => header.indexOf(n);
  const hasHeader = idx("domain") !== -1;
  const rows = hasHeader ? lines.slice(1) : lines;
  const col = (cells: string[], name: string, fallback: number) => (cells[hasHeader ? idx(name) : fallback] ?? "").trim() || null;
  return rows.map((l) => {
    const c = splitCsvLine(l);
    return {
      domain: normalizeDomain(col(c, "domain", 0) ?? ""),
      firstName: col(c, "first_name", 1),
      lastName: col(c, "last_name", 2),
      title: col(c, "title", 3),
      email: col(c, "email", 4)?.toLowerCase() ?? null,
      linkedinUrl: col(c, "linkedin_url", 5),
    };
  }).filter((r) => r.domain);
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}
