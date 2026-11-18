import { sql } from "drizzle-orm";
import { handler, json } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = handler(async () => {
  const r = await db().execute(sql`SELECT status, count(*)::int AS n FROM companies GROUP BY status`);
  return json(Object.fromEntries((r.rows as { status: string; n: number }[]).map((x) => [x.status, x.n])));
});
