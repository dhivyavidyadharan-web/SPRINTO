import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const [c] = await db().select().from(schema.companies).where(eq(schema.companies.domain, decodeURIComponent(domain)));
  if (!c) return new Response("not found", { status: 404 });
  return new Response(JSON.stringify({ ...(c.decisionLog as object), facts: c.facts }, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="decision-log-${c.domain}.json"` },
  });
}
