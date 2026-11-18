import { Annotation } from "@langchain/langgraph";

export type ReplyStatus = "no_reply" | "interested" | "not_interested" | "counter_proposal" | "confirmed" | "unclear" | "unsubscribe";
export type MeetingStatus = "unscheduled" | "pending_confirmation" | "confirmed";
export interface HistoryEntry { ts: string; node: string; action: string; result: string }

/** Events that resume the graph from waitForReply. */
export type ResumeEvent =
  | { type: "reply"; replyText: string; messageId: string; receivedAt: string; rfcMessageId?: string | null }
  | { type: "no_reply_check" }
  | { type: "human_instruction"; instruction: string; resetRounds?: boolean }
  | { type: "mark_booked"; slotIso: string }
  | { type: "move_backup" }
  | { type: "do_not_contact" }
  | { type: "retry" };

const last = <T>(d: T) => Annotation<T>({ reducer: (_a: T, b: T) => b, default: () => d });

/** Fixed state schema (Section 6.1) + a few internal routing fields (prefixed comments). */
export const AgentState = Annotation.Root({
  companyId: last<number>(0),
  domain: last<string>(""),
  companyName: last<string>(""),
  contactName: last<string>(""),
  contactTitle: last<string>(""),
  gmailThreadId: last<string | null>(null),
  agentSentMessageIds: last<string[]>([]),
  processedMessageIds: last<string[]>([]),
  replyStatus: last<ReplyStatus>("no_reply"),
  negotiationRound: last<number>(0),
  calendarChecked: last<boolean>(false),
  timesProposed: last<string[]>([]),
  rejectedTimes: last<string[]>([]),
  prospectProposedTime: last<string | null>(null),
  meetingStatus: last<MeetingStatus>("unscheduled"),
  calendarEventId: last<string | null>(null),
  followupsSent: last<0 | 1 | 2>(0),
  clarifyAsked: last<boolean>(false),
  crmLogged: last<boolean>(false),
  inputNeeded: last<boolean>(false),
  inputNeededReason: last<string | null>(null),
  lastActivityAt: last<string>(new Date(0).toISOString()),
  history: Annotation<HistoryEntry[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  // ── internal routing fields
  lastEvent: last<ResumeEvent | null>(null),
  lastReplyText: last<string | null>(null),
  lastRfcMessageId: last<string | null>(null),
  acceptedSlot: last<string | null>(null),
  declineReason: last<string | null>(null),
  openSlots: last<string[]>([]),
  slotToBook: last<string | null>(null),
  slotTakenNotice: last<boolean>(false),
  pendingAction: last<string | null>(null),
  coldSubject: last<string>(""),
  /** CRM update to apply in the updateCrm node before END. */
  crmPending: last<{ status: string; stage: string; outcome?: "booked" | "positive" | "negative" | "no_reply" | null; backupReason?: string | null; revisitAfterMs?: number | null } | null>(null),
  done: last<boolean>(false),
});

export type State = typeof AgentState.State;
export type StateUpdate = typeof AgentState.Update;
