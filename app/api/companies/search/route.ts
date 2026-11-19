import { desc, ilike, or } from "drizzle-orm";
import { handler, json } from "@/lib/api";
import { db, schema } from "@/lib/db";

export const GET = handler(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return json({ results: [] });
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const rows = await db()
    .select({ domain: schema.companies.domain, name: schema.companies.name, status: schema.companies.status, score: schema.companies.score })
    .from(schema.companies)
    .where(or(ilike(schema.companies.domain, like), ilike(schema.companies.name, like)))
    .orderBy(desc(schema.companies.updatedAt))
    .limit(8);
  return json({ results: rows });
});
