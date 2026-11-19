import { StateGraph, START, END, interrupt, type BaseCheckpointSaver } from "@langchain/langgraph";
import { AgentState, type State, type StateUpdate, type ResumeEvent, type HistoryEntry } from "./state";
import { bookMeetingTool, checkCalendarTool, updateCrmTool, type AgentDeps } from "./tools";

const firstName = (s: State) => (s.contactName || "there").split(" ")[0];

// ───────────── Short, deterministic reply templates (no invented facts) ─────────────
export const templates = {
  propose: (s: State, d: AgentDeps, slots: string[], taken: boolean) =>
    `Hi ${firstName(s)},\n\n${taken ? "Apologies — that slot was just taken on my side. " : s.negotiationRound > 0 ? "No problem. " : "Great to hear from you. "}Would either of these work for a 30-minute call?\n\n- ${slots.map((x) => d.formatSlot(x)).join("\n- ")}\n\nIf neither suits, just send a time that works for you${d.bookingLink(null) ? ` or pick one here: ${d.bookingLink(null)}` : ""}.\n\n${d.config.senderName}`.replace("30-minute", `${d.config.meetingMinutes}-minute`),
  confirm: (s: State, d: AgentDeps, slot: string) =>
    `Hi ${firstName(s)},\n\nConfirmed for ${d.formatSlot(slot)} — looking forward to it.${d.bookingLink(slot) ? `\n\nTo get the calendar invite, please lock in that time here: ${d.bookingLink(slot)}` : ""}\n\n${d.config.senderName}`,
  decline: (s: State, d: AgentDeps) =>
    `Hi ${firstName(s)},\n\nThanks for letting me know — completely understand. I won't follow up further for now. If audit readiness becomes a priority later, I'm happy to help.\n\n${d.config.senderName}`,
  clarify: (s: State, d: AgentDeps) =>
    `Hi ${firstName(s)},\n\nThanks for the reply — just to make sure I understand: would you be open to a short ${d.config.meetingMinutes}-minute call, and if so, is there a day that suits you best?\n\n${d.config.senderName}`,
};

function h(node: string, action: string, result: string, now: Date): HistoryEntry {
  return { ts: now.toISOString(), node, action, result };
}

export function buildGraph(d: AgentDeps, checkpointer?: BaseCheckpointSaver) {
  /** Wrap nodes: append history, mirror the snapshot to the DB after every node. */
  const node = (name: string, fn: (s: State) => Promise<StateUpdate>) => async (s: State): Promise<StateUpdate> => {
    const upd = await fn(s);
    const merged = { ...s, ...upd, history: [...s.history, ...((upd.history as HistoryEntry[]) ?? [])] } as State;
    await d.mirror(merged).catch(() => undefined);
    return upd;
  };

  const sendTracked = async (s: State, kind: string, body: string) => {
    const r = await d.send(s, kind, body);
    const ids = r.messageId ? [...s.agentSentMessageIds, r.messageId] : s.agentSentMessageIds;
    return { r, ids };
  };

  const g = new StateGraph(AgentState)
    // ── Pause until a reply / daily tick / human action arrives
    .addNode("waitForReply", node("waitForReply", async (s) => {
      const ev = interrupt({ waitingFor: s.inputNeeded ? "human" : "reply", stage: s.replyStatus }) as ResumeEvent;
      return { lastEvent: ev, history: [h("waitForReply", "resumed", ev.type, d.now())] };
    }))

    .addNode("classifyReply", node("classifyReply", async (s) => {
      const ev = s.lastEvent as Extract<ResumeEvent, { type: "reply" }>;
      const c = await d.classify(ev.replyText, s);
      let status = c.confidence < 0.6 ? "unclear" : c.replyStatus;
      // A time proposed before we offered any slots is interest, not a counter-offer: no round is used.
      if (status === "counter_proposal" && s.timesProposed.length === 0) status = "interested";
      const upd: StateUpdate = {
        replyStatus: status, prospectProposedTime: c.prospectProposedTime, acceptedSlot: c.acceptedSlot && s.timesProposed.includes(c.acceptedSlot) ? c.acceptedSlot : null,
        declineReason: c.declineReason, lastReplyText: ev.replyText, lastRfcMessageId: ev.rfcMessageId ?? s.lastRfcMessageId,
        processedMessageIds: [...s.processedMessageIds, ev.messageId], lastActivityAt: d.now().toISOString(),
        history: [h("classifyReply", "classified", `${status} (confidence ${c.confidence}${c.prospectProposedTime ? `, proposed ${c.prospectProposedTime}` : ""}${c.acceptedSlot ? `, accepted ${c.acceptedSlot}` : ""})`, d.now())],
      };
      if (s.replyStatus === "no_reply" && ["interested", "counter_proposal", "confirmed"].includes(status)) {
        await updateCrmTool(d, s, { status: "IN_CONVERSATION", stage: "negotiating", event: "positive_reply", payload: { replyStatus: status } });
      }
      return upd;
    }))

    .addNode("handleCounter", node("handleCounter", async (s) => {
      const round = s.negotiationRound + 1;
      return {
        rejectedTimes: [...new Set([...s.rejectedTimes, ...s.timesProposed])], negotiationRound: round, calendarChecked: false,
        history: [h("handleCounter", "counter_proposal", `round ${round}/${d.config.maxRounds}; rejected ${s.timesProposed.length} offered slot(s)`, d.now())],
      };
    }))

    .addNode("checkProposedSlot", node("checkProposedSlot", async (s) => {
      const slot = s.prospectProposedTime!;
      const end = new Date(new Date(slot).getTime() + d.config.meetingMinutes * 60_000).toISOString();
      const cal = await checkCalendarTool(d, slot, end);
      if (cal.status === "no_calendar_access" || cal.status === "unavailable") {
        return { pendingAction: cal.status, history: [h("checkProposedSlot", "checkCalendar", cal.status, d.now())] };
      }
      const ok = d.isSlotAcceptable(slot, cal.busy, d.now());
      return {
        calendarChecked: true, slotToBook: ok ? slot : null, pendingAction: null,
        history: [h("checkProposedSlot", "checkCalendar", ok ? `prospect's time ${slot} is free` : `prospect's time ${slot} is busy/outside hours`, d.now())],
      };
    }))

    .addNode("checkCalendar", node("checkCalendar", async (s) => {
      const now = d.now();
      const start = now.toISOString();
      const end = new Date(now.getTime() + d.config.bookingWindowDays * 86_400_000).toISOString();
      const cal = await checkCalendarTool(d, start, end);
      return {
        openSlots: cal.slots, calendarChecked: cal.status === "free", pendingAction: cal.status === "free" ? null : cal.status,
        history: [h("checkCalendar", "freeBusy", `${cal.status}: ${cal.slots.length} open slots (attempts ${cal.attempts})`, now)],
      };
    }))

    .addNode("proposeTimes", node("proposeTimes", async (s) => {
      const picks = d.pickTwoSlots(s.openSlots, s.rejectedTimes);
      if (!picks.length) return { pendingAction: "no_slots", history: [h("proposeTimes", "pickSlots", "no slots left outside rejectedTimes", d.now())] };
      const { r, ids } = await sendTracked(s, "scheduling", templates.propose(s, d, picks, s.slotTakenNotice));
      if (r.status === "failed") return { pendingAction: "proposeTimes", history: [h("proposeTimes", "sendEmail", `failed (${r.error}); will retry on next run`, d.now())] };
      return {
        timesProposed: picks, agentSentMessageIds: ids, meetingStatus: "pending_confirmation", slotTakenNotice: false, pendingAction: null, lastActivityAt: d.now().toISOString(),
        history: [h("proposeTimes", "sendEmail", `offered ${picks.join(", ")}`, d.now())],
      };
    }))

    .addNode("bookMeeting", node("bookMeeting", async (s) => {
      const slot = s.slotToBook!;
      const r = await bookMeetingTool(d, s, slot);
      if (r.status === "booked") {
        await d.saveMeeting(s, slot, r.endIso ?? new Date(new Date(slot).getTime() + d.config.meetingMinutes * 60_000).toISOString(), r.eventId!);
        return { calendarEventId: r.eventId, meetingStatus: "confirmed", pendingAction: null, history: [h("bookMeeting", "createEvent", `booked ${slot} (event ${r.eventId})${r.note ? ` — ${r.note}` : ""}`, d.now())] };
      }
      if (r.status === "slot_taken") {
        // Permanent: do not book; tell the prospect via proposeTimes. Counts as a round.
        return {
          rejectedTimes: [...new Set([...s.rejectedTimes, slot])], negotiationRound: s.negotiationRound + 1, slotToBook: null, slotTakenNotice: true, calendarChecked: false,
          history: [h("bookMeeting", "createEvent", `slot_taken ${slot}; counts as round ${s.negotiationRound + 1}`, d.now())],
        };
      }
      return { pendingAction: r.status === "no_calendar_access" ? "no_calendar_access" : "booking_failed", history: [h("bookMeeting", "createEvent", `${r.status}${r.note ? `: ${r.note}` : ""}`, d.now())] };
    }))

    .addNode("sendConfirmation", node("sendConfirmation", async (s) => {
      const { r, ids } = await sendTracked(s, "confirmation", templates.confirm(s, d, s.slotToBook!));
      return {
        agentSentMessageIds: ids, lastActivityAt: d.now().toISOString(), inputNeeded: false, inputNeededReason: null,
        crmPending: { status: "MEETING_BOOKED", stage: "booked", outcome: "booked" },
        history: [h("sendConfirmation", "sendEmail", r.status === "failed" ? `failed (${r.error}) — meeting is booked regardless` : "confirmation sent", d.now())],
      };
    }))

    .addNode("handleDecline", node("handleDecline", async (s) => {
      const { r, ids } = await sendTracked(s, "decline_ack", templates.decline(s, d));
      return {
        agentSentMessageIds: ids, lastActivityAt: d.now().toISOString(),
        crmPending: { status: "BACKUP", stage: "declined", outcome: "negative", backupReason: s.declineReason ?? "other", revisitAfterMs: d.config.backupNegativeMs },
        history: [h("handleDecline", "sendEmail", r.status === "failed" ? `ack failed (${r.error})` : `acknowledged decline (${s.declineReason ?? "other"})`, d.now())],
      };
    }))

    .addNode("unsubscribe", node("unsubscribe", async () => ({
      crmPending: { status: "DO_NOT_CONTACT", stage: "unsubscribed", outcome: "negative" },
      history: [h("unsubscribe", "noEmail", "prospect asked to stop — Do not contact, no email sent", d.now())],
    })))

    .addNode("askClarification", node("askClarification", async (s) => {
      const { r, ids } = await sendTracked(s, "clarify", templates.clarify(s, d));
      return { clarifyAsked: true, agentSentMessageIds: ids, lastActivityAt: d.now().toISOString(), history: [h("askClarification", "sendEmail", r.status === "failed" ? `failed (${r.error})` : "asked one clarifying question", d.now())] };
    }))

    .addNode("noReplyCheck", node("noReplyCheck", async () => ({ history: [] })))

    .addNode("sendFollowup", node("sendFollowup", async (s) => {
      const n = (s.followupsSent + 1) as 1 | 2;
      const draft = await d.draftFollowup(s, n);
      if (!draft.passed) return { pendingAction: "followup_quality_gate", history: [h("sendFollowup", "draft", `follow-up #${n} failed quality gate twice`, d.now())] };
      const { r, ids } = await sendTracked(s, `followup_${n}`, draft.body);
      if (r.status === "failed") return { history: [h("sendFollowup", "sendEmail", `follow-up #${n} failed (${r.error}); will retry on next run`, d.now())] };
      await updateCrmTool(d, s, { status: n === 1 ? "FOLLOWUP_1_SENT" : "FOLLOWUP_2_SENT", stage: `followup_${n}_sent`, event: `followup_${n}_sent` });
      return { followupsSent: n, agentSentMessageIds: ids, lastActivityAt: d.now().toISOString(), history: [h("sendFollowup", "sendEmail", `follow-up #${n} sent`, d.now())] };
    }))

    .addNode("moveToBackup", node("moveToBackup", async (s) => ({
      crmPending: { status: "BACKUP", stage: "backup", outcome: s.replyStatus === "no_reply" ? "no_reply" : "positive", backupReason: "no_reply", revisitAfterMs: d.config.backupNoReplyMs },
      history: [h("moveToBackup", "backup", "no reply after follow-ups → Backup", d.now())],
    })))

    .addNode("humanAction", node("humanAction", async (s) => {
      const ev = s.lastEvent!;
      if (ev.type === "human_instruction") {
        const body = await d.draftFromInstruction(s, ev.instruction);
        const { r, ids } = await sendTracked(s, "manual", body);
        await updateCrmTool(d, s, { status: "IN_CONVERSATION", stage: "negotiating", event: "human_instruction_sent", payload: { instruction: ev.instruction, resetRounds: !!ev.resetRounds } });
        return {
          agentSentMessageIds: ids, inputNeeded: false, inputNeededReason: null, pendingAction: null, lastActivityAt: d.now().toISOString(),
          negotiationRound: ev.resetRounds ? 0 : s.negotiationRound, clarifyAsked: ev.resetRounds ? false : s.clarifyAsked,
          history: [h("humanAction", "sendEmail", `reply from human instruction ${r.status}`, d.now())],
        };
      }
      if (ev.type === "mark_booked") return { slotToBook: ev.slotIso, inputNeeded: false, inputNeededReason: null, history: [h("humanAction", "mark_booked", ev.slotIso, d.now())] };
      if (ev.type === "move_backup") return { crmPending: { status: "BACKUP", stage: "backup", outcome: s.replyStatus === "no_reply" ? "no_reply" : "positive", backupReason: "human_moved", revisitAfterMs: d.config.backupNoReplyMs }, history: [h("humanAction", "move_backup", "", d.now())] };
      if (ev.type === "do_not_contact") return { crmPending: { status: "DO_NOT_CONTACT", stage: "unsubscribed", outcome: "negative" }, history: [h("humanAction", "do_not_contact", "", d.now())] };
      // retry
      return { inputNeeded: false, inputNeededReason: null, history: [h("humanAction", "retry", s.pendingAction ?? "", d.now())] };
    }))

    .addNode("flagInputNeeded", node("flagInputNeeded", async (s) => {
      const reason = inputReason(s, d);
      await updateCrmTool(d, s, { status: "INPUT_NEEDED", stage: "input_needed", event: "input_needed", inputNeededReason: reason, payload: { reason } });
      return { inputNeeded: true, inputNeededReason: reason, history: [h("flagInputNeeded", "flag", reason, d.now())] };
    }))

    .addNode("setSlotFromAccepted", node("setSlotFromAccepted", async (s) => ({ slotToBook: s.acceptedSlot, history: [h("setSlotFromAccepted", "accept", `prospect accepted ${s.acceptedSlot}`, d.now())] })))
    .addNode("updateCrm", node("updateCrm", async (s) => {
      const p = s.crmPending!;
      const r = await updateCrmTool(d, s, { status: p.status, stage: p.stage, event: `stage_${p.stage}`, backupReason: p.backupReason, revisitAfterMs: p.revisitAfterMs });
      if (p.outcome) await d.recordOutcome(s, p.outcome).catch(() => undefined);
      return { crmLogged: r.status === "logged", done: true, history: [h("updateCrm", "updateCrm", `${p.status} → ${r.status}${r.error ? ` (${r.error})` : ""}`, d.now())] };
    }))

    // ───────────── Edges ─────────────
    .addEdge(START, "waitForReply")
    .addConditionalEdges("waitForReply", (s) => {
      const ev = s.lastEvent!;
      if (ev.type === "reply") return s.inputNeeded ? "waitForReply" : "classifyReply"; // paused while Input needed
      if (ev.type === "no_reply_check") return s.inputNeeded ? "waitForReply" : "noReplyCheck";
      return "humanAction";
    }, ["classifyReply", "noReplyCheck", "humanAction", "waitForReply"])

    .addConditionalEdges("classifyReply", (s) => {
      switch (s.replyStatus) {
        case "interested":
          if (s.prospectProposedTime) return "checkProposedSlot";
          return "checkCalendar";
        case "counter_proposal": return "handleCounter";
        case "confirmed":
          if (s.acceptedSlot) return "setSlotFromAccepted";
          if (s.prospectProposedTime) return "checkProposedSlot";
          return s.timesProposed.length ? (s.clarifyAsked ? "flagInputNeeded" : "askClarification") : "checkCalendar";
        case "not_interested": return "handleDecline";
        case "unsubscribe": return "unsubscribe";
        default: return s.clarifyAsked ? "flagInputNeeded" : "askClarification";
      }
    }, ["checkProposedSlot", "checkCalendar", "handleCounter", "setSlotFromAccepted", "askClarification", "flagInputNeeded", "handleDecline", "unsubscribe"])


    .addConditionalEdges("handleCounter", (s) => {
      if (s.negotiationRound > d.config.maxRounds) return "flagInputNeeded";
      return s.prospectProposedTime ? "checkProposedSlot" : "checkCalendar";
    }, ["flagInputNeeded", "checkProposedSlot", "checkCalendar"])

    .addConditionalEdges("checkProposedSlot", (s) => (s.pendingAction ? "flagInputNeeded" : s.slotToBook ? "bookMeeting" : "checkCalendar"), ["flagInputNeeded", "bookMeeting", "checkCalendar"])
    .addConditionalEdges("checkCalendar", (s) => (s.pendingAction ? "flagInputNeeded" : "proposeTimes"), ["flagInputNeeded", "proposeTimes"])
    .addConditionalEdges("proposeTimes", (s) => (s.pendingAction === "no_slots" ? "flagInputNeeded" : "waitForReply"), ["flagInputNeeded", "waitForReply"])
    .addConditionalEdges("bookMeeting", (s) => {
      if (s.meetingStatus === "confirmed") return "sendConfirmation";
      if (s.slotTakenNotice) return s.negotiationRound > d.config.maxRounds ? "flagInputNeeded" : "checkCalendar";
      return "flagInputNeeded";
    }, ["sendConfirmation", "checkCalendar", "flagInputNeeded"])
    .addEdge("setSlotFromAccepted", "bookMeeting")
    .addEdge("sendConfirmation", "updateCrm")
    .addEdge("handleDecline", "updateCrm")
    .addEdge("unsubscribe", "updateCrm")
    .addEdge("askClarification", "waitForReply")
    .addEdge("moveToBackup", "updateCrm")
    .addEdge("updateCrm", END)
    .addEdge("flagInputNeeded", "waitForReply")

    .addConditionalEdges("noReplyCheck", (s) => {
      if (s.pendingAction === "proposeTimes") return "checkCalendar"; // retry a failed send from last run
      if (s.done || s.meetingStatus === "confirmed") return "waitForReply";
      const elapsed = d.now().getTime() - new Date(s.lastActivityAt).getTime();
      if (s.replyStatus !== "no_reply") {
        // Prospect engaged then went silent: no "new angle" follow-ups mid-negotiation; Backup after both windows.
        return elapsed >= d.config.followup1Ms + d.config.followup2Ms ? "moveToBackup" : "waitForReply";
      }
      if (s.followupsSent === 0 && elapsed >= d.config.followup1Ms) return "sendFollowup";
      if (s.followupsSent === 1 && elapsed >= d.config.followup2Ms) return "sendFollowup";
      if (s.followupsSent === 2 && elapsed >= d.config.followup2Ms) return "moveToBackup";
      return "waitForReply";
    }, ["checkCalendar", "sendFollowup", "moveToBackup", "waitForReply"])
    .addConditionalEdges("sendFollowup", (s) => (s.pendingAction === "followup_quality_gate" ? "flagInputNeeded" : "waitForReply"), ["flagInputNeeded", "waitForReply"])

    .addConditionalEdges("humanAction", (s) => {
      const ev = s.lastEvent!;
      if (ev.type === "human_instruction") return "waitForReply";
      if (ev.type === "mark_booked") return "bookMeeting";
      if (ev.type === "move_backup" || ev.type === "do_not_contact") return "updateCrm";
      // retry
      if (s.pendingAction === "followup_quality_gate") return "sendFollowup";
      if (s.slotToBook && s.meetingStatus !== "confirmed") return "bookMeeting";
      return "checkCalendar";
    }, ["waitForReply", "bookMeeting", "updateCrm", "sendFollowup", "checkCalendar"]);

  return g.compile({ checkpointer });
}

function inputReason(s: State, d: AgentDeps): string {
  if (s.negotiationRound > d.config.maxRounds) return `no time agreed after ${d.config.maxRounds} rounds`;
  switch (s.pendingAction) {
    case "no_calendar_access": return "reconnect Google";
    case "unavailable": return "calendar unavailable";
    case "booking_failed": return "calendar booking failed after retries";
    case "no_slots": return "no free calendar slots in the booking window";
    case "followup_quality_gate": return "email_failed_quality_gate (follow-up)";
  }
  if (s.clarifyAsked && (s.replyStatus === "unclear" || s.replyStatus === "confirmed")) return "reply unclear after one clarification";
  return "agent could not resolve this conversation";
}
