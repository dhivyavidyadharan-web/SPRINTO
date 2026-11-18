import { describe, it, expect } from "vitest";
import { Command, MemorySaver } from "@langchain/langgraph";
import { buildGraph } from "@/lib/agent/graph";
import type { AgentDeps, ClassifyResult } from "@/lib/agent/tools";
import type { ResumeEvent, State } from "@/lib/agent/state";
import { computeOpenSlots, pickTwoSlots } from "@/lib/google/calendar";

const NOW = new Date("2026-11-18T04:00:00Z"); // Wed 09:30 IST
const DAY = 86_400_000;

function harness(opts: { classify?: (ClassifyResult | ((s: State) => ClassifyResult))[]; createEventFails?: number; busy?: { start: string; end: string }[] } = {}) {
  let clock = NOW.getTime();
  const sent: { kind: string; body: string }[] = [];
  const crm: string[] = [];
  const outcomes: string[] = [];
  const events: { id: string; slot: string }[] = [];
  const queue = [...(opts.classify ?? [])];
  let createCalls = 0;
  let failuresLeft = opts.createEventFails ?? 0;
  const deps: AgentDeps = {
    now: () => new Date(clock),
    classify: async (_t, st) => { const q = queue.shift(); if (typeof q === "function") return q(st); if (q) return q; return { replyStatus: "unclear", prospectProposedTime: null, acceptedSlot: null, declineReason: null, confidence: 0.2 }; },
    freeBusy: async () => opts.busy ?? [],
    computeOpenSlots: (s, e, busy, now) => computeOpenSlots({ startIso: s, endIso: e, busy, now, tz: "Asia/Kolkata", minutes: 30, businessStart: "10:00", businessEnd: "18:00", windowDays: 14 }),
    isSlotAcceptable: (slot, busy) => !busy.some((b) => b.start <= slot && b.end > slot),
    pickTwoSlots: (slots, rej) => pickTwoSlots(slots, rej, "Asia/Kolkata"),
    formatSlot: (iso) => iso,
    findEvent: async () => (events[0] ? { id: events[0].id } : null),
    createEvent: async (_s, slot) => {
      createCalls++;
      // Simulate: the insert succeeds server-side but the client times out.
      events.push({ id: `ev${events.length + 1}`, slot });
      if (failuresLeft-- > 0) throw Object.assign(new Error("timeout"), { code: 504 });
      return { eventId: events[events.length - 1].id, endIso: slot };
    },
    send: async (_s, kind, body) => { sent.push({ kind, body }); return { status: "sent", messageId: `m${sent.length}` }; },
    draftFollowup: async (_s, n) => ({ body: `Hi Priya, follow-up ${n}`, passed: true, failures: [] }),
    draftFromInstruction: async (_s, i) => `Hi Priya, ${i}`,
    updateCrm: async (_s, u) => { if (u.status) crm.push(u.status); },
    recordOutcome: async (_s, o) => { outcomes.push(o); },
    saveMeeting: async () => undefined,
    mirror: async () => undefined,
    errorKind: (e) => ((e as { code?: number }).code === 504 ? "transient" : "other"),
    sleep: async () => undefined,
    config: { meetingMinutes: 30, bookingWindowDays: 14, maxRounds: 3, followup1Ms: 7 * DAY, followup2Ms: 7 * DAY, backupNegativeMs: 90 * DAY, backupNoReplyMs: 60 * DAY, senderName: "Test" },
  };
  const g = buildGraph(deps, new MemorySaver());
  const cfg = { configurable: { thread_id: "1" } };
  let n = 0;
  return {
    sent, crm, outcomes, events, get createCalls() { return createCalls; },
    advance: (ms: number) => { clock += ms; },
    start: () => g.invoke({ companyId: 1, contactName: "Priya Rao", companyName: "Acme", lastActivityAt: new Date(clock).toISOString(), agentSentMessageIds: ["m0"] }, cfg),
    reply: (text = "reply") => g.invoke(new Command({ resume: { type: "reply", replyText: text, messageId: `p${++n}`, receivedAt: new Date(clock).toISOString() } satisfies ResumeEvent }), cfg),
    tick: () => g.invoke(new Command({ resume: { type: "no_reply_check" } satisfies ResumeEvent }), cfg),
    state: async () => (await g.getState(cfg)).values as State,
    next: async () => (await g.getState(cfg)).next,
  };
}

const cls = (replyStatus: ClassifyResult["replyStatus"], extra: Partial<ClassifyResult> = {}): ClassifyResult =>
  ({ replyStatus, prospectProposedTime: null, acceptedSlot: null, declineReason: null, confidence: 0.9, ...extra });

describe("reply & scheduling agent", () => {
  it("interested → propose → confirmed → booked", async () => {
    const h = harness({ classify: [cls("interested"), (s) => cls("confirmed", { acceptedSlot: s.timesProposed[1] })] });
    await h.start();
    await h.reply("Sounds interesting, happy to chat");
    let s = await h.state();
    expect(s.timesProposed).toHaveLength(2);
    expect(s.timesProposed[0].slice(0, 10)).not.toBe(s.timesProposed[1].slice(0, 10));
    expect(h.crm).toContain("IN_CONVERSATION");
    const chosen = s.timesProposed[1];
    await h.reply("The second one works");
    s = await h.state();
    expect(s.meetingStatus).toBe("confirmed");
    expect(s.slotToBook).toBe(chosen);
    expect(s.calendarEventId).toBe("ev1");
    expect(h.crm.at(-1)).toBe("MEETING_BOOKED");
    expect(h.outcomes).toEqual(["booked"]);
    expect(h.sent.map((x) => x.kind)).toEqual(["scheduling", "confirmation"]);
    expect(await h.next()).toEqual([]);
  });

  it("3 counter-proposals then a 4th → Input needed", async () => {
    const h = harness({ classify: [cls("interested"), cls("counter_proposal"), cls("counter_proposal"), cls("counter_proposal"), cls("counter_proposal")] });
    await h.start();
    await h.reply();
    for (let i = 0; i < 3; i++) await h.reply("none of those work");
    let s = await h.state();
    expect(s.negotiationRound).toBe(3);
    expect(s.inputNeeded).toBe(false);
    expect(h.sent.filter((x) => x.kind === "scheduling")).toHaveLength(4);
    // rejected times are never offered again
    expect(s.timesProposed.some((t) => s.rejectedTimes.includes(t))).toBe(false);
    await h.reply("still no");
    s = await h.state();
    expect(s.inputNeeded).toBe(true);
    expect(s.inputNeededReason).toMatch(/3 rounds/);
    expect(h.crm.at(-1)).toBe("INPUT_NEEDED");
  });

  it("negative → Backup with revisit date", async () => {
    const h = harness({ classify: [cls("not_interested", { declineReason: "not_now" })] });
    await h.start();
    await h.reply("Not right now, thanks");
    const s = await h.state();
    expect(s.crmPending?.status).toBe("BACKUP");
    expect(s.crmPending?.revisitAfterMs).toBe(90 * DAY);
    expect(s.crmPending?.backupReason).toBe("not_now");
    expect(h.sent.map((x) => x.kind)).toEqual(["decline_ack"]);
    expect(h.outcomes).toEqual(["negative"]);
  });

  it("unsubscribe → Do not contact, no email", async () => {
    const h = harness({ classify: [cls("unsubscribe")] });
    await h.start();
    await h.reply("Please stop emailing me");
    expect(h.crm.at(-1)).toBe("DO_NOT_CONTACT");
    expect(h.sent).toHaveLength(0);
  });

  it("no reply → follow-up 1 → follow-up 2 → Backup", async () => {
    const h = harness();
    await h.start();
    await h.tick();
    expect(h.sent).toHaveLength(0); // nothing due yet
    h.advance(7 * DAY);
    await h.tick();
    expect(h.sent.map((x) => x.kind)).toEqual(["followup_1"]);
    expect(h.crm.at(-1)).toBe("FOLLOWUP_1_SENT");
    h.advance(3 * DAY);
    await h.tick();
    expect(h.sent).toHaveLength(1);
    h.advance(4 * DAY);
    await h.tick();
    expect(h.sent.map((x) => x.kind)).toEqual(["followup_1", "followup_2"]);
    h.advance(7 * DAY);
    await h.tick();
    expect(h.crm.at(-1)).toBe("BACKUP");
    expect(h.outcomes).toEqual(["no_reply"]);
    expect((await h.state()).crmPending?.revisitAfterMs).toBe(60 * DAY);
  });

  it("unclear → clarify → unclear → Input needed", async () => {
    const h = harness({ classify: [cls("unclear"), cls("interested", { confidence: 0.4 })] });
    await h.start();
    await h.reply("hmm");
    expect(h.sent.map((x) => x.kind)).toEqual(["clarify"]);
    await h.reply("maybe?");
    const s = await h.state();
    expect(s.inputNeeded).toBe(true);
    expect(s.inputNeededReason).toMatch(/unclear after one clarification/);
  });

  it("bookMeeting retry after timeout never double-books", async () => {
    const h = harness({ createEventFails: 1, classify: [cls("interested", { prospectProposedTime: "2026-11-19T06:30:00.000Z" })] });
    await h.start();
    await h.reply("Can we do Thursday 12pm?");
    const s = await h.state();
    expect(s.meetingStatus).toBe("confirmed");
    expect(h.events).toHaveLength(1);
    expect(h.createCalls).toBe(1);
  });

  it("prospect-proposed busy time → offers alternatives instead", async () => {
    const h = harness({ busy: [{ start: "2026-11-19T06:00:00.000Z", end: "2026-11-19T08:00:00.000Z" }], classify: [cls("interested", { prospectProposedTime: "2026-11-19T06:30:00.000Z" })] });
    await h.start();
    await h.reply("Thursday 12pm?");
    const s = await h.state();
    expect(s.meetingStatus).toBe("pending_confirmation");
    expect(s.timesProposed).toHaveLength(2);
    expect(h.events).toHaveLength(0);
  });
});
