import { and, eq, like } from "drizzle-orm";
import { handler, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { parseContactsCsv } from "@/lib/pipeline/contacts";
import { logEvent } from "@/lib/db/events";

export const POST = handler(async (req: Request) => {
  const { csv } = (await req.json()) as { csv: string };
  const rows = parseContactsCsv(csv ?? "");
  if (!rows.length) return json({ error: "no rows parsed (expected header: domain,first_name,last_name,title,email,linkedin_url)" }, 400);
  let inserted = 0;
  for (const r of rows) {
    const dup = r.email ? await db().select().from(schema.contacts).where(and(eq(schema.contacts.domain, r.domain), eq(schema.contacts.email, r.email))) : [];
    if (dup.length) {
      await db().update(schema.contacts).set({ firstName: r.firstName, lastName: r.lastName, title: r.title, linkedinUrl: r.linkedinUrl }).where(eq(schema.contacts.id, dup[0].id));
    } else {
      await db().insert(schema.contacts).values({ ...r, source: "apollo_manual" });
      inserted++;
    }
  }
  // Auto-resume companies that were waiting for a contact (Step 4).
  const domains = [...new Set(rows.map((r) => r.domain))];
  const resumed: string[] = [];
  for (const d of domains) {
    const waiting = await db().select().from(schema.companies).where(and(eq(schema.companies.domain, d), eq(schema.companies.status, "INPUT_NEEDED"), like(schema.companies.inputNeededReason, "no_contact_found%")));
    for (const c of waiting) {
      await db().update(schema.companies).set({ status: "QUEUED", resumeFrom: "contacts", inputNeededReason: null, updatedAt: new Date() }).where(eq(schema.companies.id, c.id));
      await logEvent(c.id, "human", "contact_uploaded_resume", { domain: d });
      resumed.push(d);
    }
  }
  return json({ parsed: rows.length, inserted, updated: rows.length - inserted, resumed });
});

export const GET = handler(async () => json(await db().select().from(schema.contacts).orderBy(schema.contacts.domain)));
