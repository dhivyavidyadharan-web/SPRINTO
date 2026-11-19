import { eq } from "drizzle-orm";
import { handler, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { logEvent } from "@/lib/db/events";

/**
 * Cold-deal actions from the dashboard.
 *  - reengage: re-queue a Backup / Not-ready company now (fresh research → new verdict → new email if still qualified)
 *  - dnc: mark Do not contact
 */
export const POST = handler(async (req: Request, { params }: { params: Promise<{ companyId: string }> }) => {
  const id = Number((await params).companyId);
  const { action } = (await req.json()) as { action: "reengage" | "dnc" };
  const [c] = await db().select().from(schema.companies).where(eq(schema.companies.id, id));
  if (!c) return json({ error: "not found" }, 404);
  if (action === "reengage") {
    if (!["BACKUP", "NURTURE"].includes(c.status)) return json({ error: `Only Backup / Not-ready deals can be re-engaged (status is ${c.status})` }, 409);
    await db().update(schema.companies).set({ status: "QUEUED", resumeFrom: null, revisitAfter: null, inputNeededReason: null, updatedAt: new Date() }).where(eq(schema.companies.id, id));
    await logEvent(id, "human", "reengage_requested", { previousStatus: c.status, backupReason: c.backupReason });
    return json({ ok: true, note: "Queued — run the pipeline to research it again and send a fresh email if it still qualifies." });
  }
  if (action === "dnc") {
    await db().update(schema.companies).set({ status: "DO_NOT_CONTACT", revisitAfter: null, updatedAt: new Date() }).where(eq(schema.companies.id, id));
    await logEvent(id, "human", "marked_do_not_contact", {});
    return json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
});
