import { eq } from "drizzle-orm";
import { handler, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { logEvent } from "@/lib/db/events";

export const PATCH = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const b = (await req.json()) as { text?: string; status?: "active" | "retired"; kind?: "do" | "dont" };
  const set: Partial<typeof schema.rules.$inferInsert> = {};
  if (b.text?.trim()) set.text = b.text.trim();
  if (b.status) set.status = b.status;
  if (b.kind) set.kind = b.kind;
  await db().update(schema.rules).set(set).where(eq(schema.rules.id, Number(id)));
  await logEvent(null, "human", "rule_edited", { id: Number(id), ...b });
  return json({ ok: true });
});
