import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { logEvent } from "./db/events";
import { config } from "./env";
import { getConversationState, resumeConversation } from "./agent/runtime";
import { recordHookOutcome } from "./feedback";

export type InputAction =
  | { action: "instruction"; instruction: string; resetRounds?: boolean }
  | { action: "mark_booked"; slotIso: string }
  | { action: "move_backup" }
  | { action: "do_not_contact" }
  | { action: "override_qualified" }
  | { action: "retry" };

/** Every human action from the Input-needed queue. Recorded in events with actor "human". */
export async function applyInputAction(companyId: number, a: InputAction) {
  const [c] = await db().select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!c) throw new Error("company not found");
  await logEvent(companyId, "human", `input_action_${a.action}`, a);

  const conv = await getConversationState(companyId).catch(() => ({ values: undefined, next: [] as string[] }));
  const live = !!conv.values && conv.next.length > 0;

  if (live) {
    // Conversation-level: resume the paused LangGraph thread with the human event.
    switch (a.action) {
      case "instruction": return resumeConversation(companyId, { type: "human_instruction", instruction: a.instruction, resetRounds: a.resetRounds }, "human");
      case "mark_booked": return resumeConversation(companyId, { type: "mark_booked", slotIso: new Date(a.slotIso).toISOString() }, "human");
      case "move_backup": return resumeConversation(companyId, { type: "move_backup" }, "human");
      case "do_not_contact": return resumeConversation(companyId, { type: "do_not_contact" }, "human");
      case "retry": return resumeConversation(companyId, { type: "retry" }, "human");
      case "override_qualified": throw new Error("override only applies to pipeline verdicts");
    }
  }

  // Company-level (pipeline) items.
  const set = (s: Partial<typeof schema.companies.$inferInsert>) => db().update(schema.companies).set({ updatedAt: new Date(), ...s }).where(eq(schema.companies.id, companyId));
  switch (a.action) {
    case "override_qualified":
      await set({ status: "QUEUED", resumeFrom: "override_qualified", inputNeededReason: null });
      return { queued: true, note: "Run the pipeline to execute Steps 4–7" };
    case "retry": {
      const reason = c.inputNeededReason ?? "";
      // Quality-gate failure → re-draft from Step 4; anything else → full re-run.
      await set({ status: "QUEUED", resumeFrom: /quality_gate|no_contact/.test(reason) ? "contacts" : null, inputNeededReason: null });
      return { queued: true };
    }
    case "move_backup":
      await set({ status: "BACKUP", backupReason: "human_moved", revisitAfter: new Date(Date.now() + config.backupRevisitNoReplyMs), inputNeededReason: null });
      return { ok: true };
    case "do_not_contact":
      await set({ status: "DO_NOT_CONTACT", inputNeededReason: null, revisitAfter: null });
      return { ok: true };
    case "mark_booked": {
      const start = new Date(a.slotIso);
      await db().insert(schema.meetings).values({ companyId, startAt: start, endAt: new Date(start.getTime() + config.meetingMinutes * 60_000) });
      await set({ status: "MEETING_BOOKED", inputNeededReason: null });
      await recordHookOutcome(companyId, "booked");
      return { ok: true };
    }
    case "instruction":
      throw new Error("No active conversation to reply in for this company.");
  }
}
