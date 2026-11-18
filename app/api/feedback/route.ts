import { eq } from "drizzle-orm";
import { handler, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { distilFeedback } from "@/lib/feedback";
import { logEvent } from "@/lib/db/events";

export const maxDuration = 60;

export const POST = handler(async (req: Request) => {
  const b = (await req.json()) as { emailId: number; verdict: "good" | "bad"; working?: string; notWorking?: string; editedBody?: string };
  if (!b.emailId || !["good", "bad"].includes(b.verdict)) return json({ error: "emailId and verdict (good|bad) are required" }, 400);
  const [fb] = await db().insert(schema.feedback).values({ emailId: b.emailId, verdict: b.verdict, working: b.working || null, notWorking: b.notWorking || null, editedBody: b.editedBody || null }).returning();
  const [email] = await db().select().from(schema.emails).where(eq(schema.emails.id, b.emailId));
  await logEvent(email?.companyId ?? null, "human", "feedback_submitted", { feedbackId: fb.id, verdict: b.verdict });
  const result = await distilFeedback(fb.id).catch((e) => ({ error: String(e) }));
  return json({ feedbackId: fb.id, ...result });
});
