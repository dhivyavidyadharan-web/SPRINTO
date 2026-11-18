/**
 * Agent tools (Section 6.2). Each has a description covering the 4 golden rules:
 * what it does / when to use / when NOT to use / what it returns.
 * Implementations go through AgentDeps so the graph is testable with mocks.
 * The retry table (Section 6.4) is implemented here.
 */
import type { State } from "./state";

export const TOOL_DESCRIPTIONS = {
  checkCalendar: "Checks free/busy on my Google Calendar and returns open MEETING_MINUTES slots within business hours (TIMEZONE), weekdays only. Use when the prospect is interested, proposes a time, or counter-proposes. Do not use to list existing meetings, and never for dates beyond BOOKING_WINDOW_DAYS (max 30). Returns { status: 'free'|'busy'|'no_calendar_access', slots: string[] }.",
  sendEmail: "Sends a reply in the existing Gmail thread, always to MY_EMAIL. Use to propose times, confirm a booking, ask one clarifying question, acknowledge a decline, or send a follow-up. Never starts a new thread, never emails anyone except MY_EMAIL. Returns { status: 'sent'|'failed', messageId }.",
  proposeTimes: "Picks 2 open slots on different days that are not in rejectedTimes, drafts a short reply offering them, and sends it. Use only after checkCalendar returned free slots in this round. Do not use when meetingStatus is confirmed. Returns { timesProposed: [iso, iso], messageId }.",
  bookMeeting: "Creates a Calendar event on my calendar for the agreed slot; title 'Sprinto intro — {contactName}, {company}', description includes the thread link; the only attendee is MY_EMAIL. Use only when the prospect confirmed a slot we offered, or proposed a slot that checkCalendar just confirmed free. Do not use on a tentative 'maybe'. Before creating, search for an existing event tagged with this companyId to prevent double-booking. Returns { status: 'booked'|'slot_taken'|'failed', eventId }.",
  updateCrm: "Updates the company's status, conversation stage and events timeline in the database. Use at every stage change. Returns { status: 'logged'|'failed' }.",
  flagInputNeeded: "Moves the conversation to the dashboard's Input needed column with a clear reason and pauses the thread. Use only for the cases listed in Section 8 (no time after 3 rounds, unclear after one clarification, calendar/Google problem after retries, follow-up failed quality gate). Returns { status: 'flagged' }.",
} as const;

export interface ClassifyResult {
  replyStatus: "interested" | "not_interested" | "counter_proposal" | "confirmed" | "unclear" | "unsubscribe";
  prospectProposedTime: string | null;
  acceptedSlot: string | null;
  declineReason: "not_now" | "no_need" | "using_competitor" | "no_budget" | "other" | null;
  confidence: number;
}

export interface CrmUpdate {
  status?: string;
  stage: string;
  event: string;
  payload?: Record<string, unknown>;
  backupReason?: string | null;
  revisitAfterMs?: number | null;
  inputNeededReason?: string | null;
}

/** All side effects the graph needs. Real implementations in runtime.ts; fakes in tests. */
export interface AgentDeps {
  now(): Date;
  classify(replyText: string, s: State): Promise<ClassifyResult>;
  freeBusy(startIso: string, endIso: string): Promise<{ start: string; end: string }[]>;
  computeOpenSlots(startIso: string, endIso: string, busy: { start: string; end: string }[], now: Date): string[];
  isSlotAcceptable(slotIso: string, busy: { start: string; end: string }[], now: Date): boolean;
  pickTwoSlots(slots: string[], rejected: string[]): string[];
  formatSlot(iso: string): string;
  findEvent(companyId: number): Promise<{ id: string } | null>;
  createEvent(s: State, slotIso: string): Promise<{ eventId: string; endIso: string }>;
  send(s: State, kind: string, body: string): Promise<{ status: "sent" | "failed" | "dry_run"; messageId: string | null; rfcMessageId?: string | null; error?: string }>;
  draftFollowup(s: State, n: 1 | 2): Promise<{ body: string; passed: boolean; failures: string[][] }>;
  draftFromInstruction(s: State, instruction: string): Promise<string>;
  updateCrm(s: State, u: CrmUpdate): Promise<void>;
  recordOutcome(s: State, outcome: "booked" | "positive" | "negative" | "no_reply"): Promise<void>;
  saveMeeting(s: State, startIso: string, endIso: string, eventId: string): Promise<void>;
  mirror(s: State): Promise<void>;
  errorKind(e: unknown): "auth" | "transient" | "other";
  sleep(ms: number): Promise<void>;
  config: { meetingMinutes: number; bookingWindowDays: number; maxRounds: number; followup1Ms: number; followup2Ms: number; backupNegativeMs: number; backupNoReplyMs: number; senderName: string };
}

// ───────────── Tool implementations with the retry table ─────────────

export async function checkCalendarTool(d: AgentDeps, startIso: string, endIso: string): Promise<{ status: "free" | "busy" | "no_calendar_access" | "unavailable"; slots: string[]; busy: { start: string; end: string }[]; attempts: number }> {
  const maxEnd = new Date(d.now().getTime() + Math.min(d.config.bookingWindowDays, 30) * 86_400_000).toISOString();
  const end = endIso > maxEnd ? maxEnd : endIso;
  let attempts = 0;
  for (let i = 0; i <= 3; i++) { // 1 try + 3 retries for transient errors
    attempts++;
    try {
      const busy = await d.freeBusy(startIso, end);
      const slots = d.computeOpenSlots(startIso, end, busy, d.now());
      return { status: slots.length ? "free" : "busy", slots, busy, attempts };
    } catch (e) {
      const k = d.errorKind(e);
      if (k === "auth") return { status: "no_calendar_access", slots: [], busy: [], attempts };
      if (i === 3) break;
      await d.sleep(500 * 2 ** i);
    }
  }
  return { status: "unavailable", slots: [], busy: [], attempts };
}

export async function bookMeetingTool(d: AgentDeps, s: State, slotIso: string): Promise<{ status: "booked" | "slot_taken" | "failed" | "no_calendar_access"; eventId: string | null; endIso?: string; note?: string }> {
  // Idempotency: never double-book this company.
  try {
    const existing = await d.findEvent(s.companyId);
    if (existing) return { status: "booked", eventId: existing.id, note: "existing event found — not creating another" };
  } catch (e) {
    if (d.errorKind(e) === "auth") return { status: "no_calendar_access", eventId: null };
  }
  // Slot still free?
  try {
    const end = new Date(new Date(slotIso).getTime() + d.config.meetingMinutes * 60_000).toISOString();
    const busy = await d.freeBusy(slotIso, end);
    if (busy.some((b) => new Date(b.start) < new Date(end) && new Date(b.end) > new Date(slotIso))) return { status: "slot_taken", eventId: null };
  } catch (e) {
    if (d.errorKind(e) === "auth") return { status: "no_calendar_access", eventId: null };
  }
  for (let i = 0; i <= 3; i++) {
    try {
      const r = await d.createEvent(s, slotIso);
      return { status: "booked", eventId: r.eventId, endIso: r.endIso };
    } catch (e) {
      const k = d.errorKind(e);
      if (k === "auth") return { status: "no_calendar_access", eventId: null };
      if (k !== "transient" || i === 3) return { status: "failed", eventId: null, note: String(e).slice(0, 200) };
      // The insert may have succeeded before the timeout: check before retrying.
      try {
        const existing = await d.findEvent(s.companyId);
        if (existing) return { status: "booked", eventId: existing.id, note: "found event after timeout" };
      } catch { /* ignore */ }
      await d.sleep(500 * 2 ** i);
    }
  }
  return { status: "failed", eventId: null };
}

export async function updateCrmTool(d: AgentDeps, s: State, u: CrmUpdate): Promise<{ status: "logged" | "failed"; error?: string }> {
  let err: unknown;
  for (let i = 0; i <= 3; i++) {
    try { await d.updateCrm(s, u); return { status: "logged" }; } catch (e) { err = e; if (i < 3) await d.sleep(300 * 2 ** i); }
  }
  return { status: "failed", error: String(err).slice(0, 200) };
}
