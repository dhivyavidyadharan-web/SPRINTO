import { handler, json } from "@/lib/api";
import { resumeConversation } from "@/lib/agent/runtime";

export const maxDuration = 60;

export const POST = handler(async (req: Request, { params }: { params: Promise<{ companyId: string }> }) => {
  const { companyId } = await params;
  const { text } = (await req.json()) as { text: string };
  if (!text?.trim()) return json({ error: "empty reply" }, 400);
  const r = await resumeConversation(Number(companyId), { type: "reply", replyText: text.trim(), messageId: `sim-${Date.now()}`, receivedAt: new Date().toISOString() }, "human");
  return r.resumed ? json({ ok: true }) : json({ error: r.reason }, 409);
});
