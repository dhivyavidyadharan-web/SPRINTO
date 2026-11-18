/** Verifies the Neon connection (Drizzle over HTTP) and the LangGraph Postgres checkpointer (pg over TCP). */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });
import { sql } from "drizzle-orm";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { db } from "../lib/db";

async function main() {
  const r = await db().execute(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`);
  console.log("drizzle/neon-http OK — public tables:", (r.rows[0] as { n: number }).n);
  const q = await db().execute(sql`SELECT id FROM companies WHERE status = 'QUEUED' ORDER BY (resume_from IS NULL) ASC, updated_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`);
  console.log("queue claim SQL OK — rows:", q.rows.length);
  const saver = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
  await saver.setup();
  console.log("LangGraph checkpointer OK (tables created)");
  await (saver as unknown as { end?: () => Promise<void> }).end?.();
  const t = await db().execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`);
  console.log((t.rows as { table_name: string }[]).map((x) => x.table_name).join(", "));
}
main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
