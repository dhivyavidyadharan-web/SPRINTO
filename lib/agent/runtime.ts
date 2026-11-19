import { Command, MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "../db";
import { config } from "../env";
import { logEvent } from "../db/events";
import { generateJson } from "../llm/gemini";
import { buildGraph } from "./graph";
import type { AgentDeps, ClassifyResult } from "./tools";
import type { ResumeEvent, State } from "./state";
import { sendEmail, fetchReplies, stripQuoted } from "../mail";
import { normalizeBody } from "../mail/layout";
import { computeOpenSlots, formatSlot, pickTwoSlots, zonedParts } from "../calendar/slots";
import { bookSlot, busyIntervals, classifyCalendarError, slotLink } from "../calendar/calendly";
import { draftFollowup } from "../pipeline/draft";
import type { DecisionLog } from "../pipeline/decisionLog";
import { computeVerdict, type PageType } from "../rubric";
import type { Facts } from "../facts";
import { getActiveRules, hookSummary, markRulesApplied, recordHookOutcome } from "../feedback";
import { EMAIL_LIMITS, BANNED_PHRASES, SPRINTO_FACTS } from "../rubric";

// ───────────── Checkpointer ─────────────
let saverPromise: Promise<BaseCheckpointSaver> | null = null;
function checkpointer(): Promise<BaseCheckpointSaver> {
  if (!saverPromise) {
    saverPromise = (async () => {
      if (!config.databaseUrl) return new MemorySaver();
      const s = PostgresSaver.fromConnString(config.databaseUrl);
      await s.setup();
      return s;
    })();
  }
  return saverPromise;
}

// ───────────── Real dependencies ─────────────
const ClassifySchema = z.object({
  replyStatus: z.enum(["interested", "not_interested", "counter_proposal", "confirmed", "unclear", "unsubscribe"]),
  prospectProposedTime: z.string().nullable(),
  acceptedSlot: z.string().nullable(),
  declineReason: z.enum(["not_now", "no_need", "using_competitor", "no_budget", "other"]).nullable(),
  confidence: z.number(),
});

async function companyContext(companyId: number) {
  const [c] = await db().select().from(schema.companies).where(eq(schema.companies.id, companyId));
  return c;
}

export function realDeps(): AgentDeps {
  return {
    now: () => new Date(),
    async classify(replyText, s) {
      const now = new Date();
      const z0 = zonedParts(now, config.timezone);
      return generateJson({
        slot: "fast", purpose: "classify_reply", temperature: 0, schema: ClassifySchema,
        system: `You classify a prospect's email reply in a meeting-scheduling conversation.
replyStatus:
- "interested": positive, open to talk, but no specific acceptance of an offered slot and no counter time
- "confirmed": accepts one of the OFFERED slots (set acceptedSlot to that exact ISO string from the offered list)
- "counter_proposal": none of the offered times work and/or they propose a different time (set prospectProposedTime if a specific time is given)
- "not_interested": declines (set declineReason)
- "unsubscribe": explicitly asks to stop emailing / unsubscribe / remove them
- "unclear": cannot tell
prospectProposedTime: ISO 8601 with offset, interpreted in ${config.timezone} (today is ${z0.weekday} ${z0.y}-${String(z0.m).padStart(2, "0")}-${String(z0.d).padStart(2, "0")}), or null if no specific day+time.
confidence: 0..1. Return JSON only.`,
        prompt: `Offered slots (ISO): ${JSON.stringify(s.timesProposed)}\nOffered (human-readable): ${s.timesProposed.map((t) => formatSlot(t)).join(" | ") || "none yet"}\n\nReply:\n"""${replyText.slice(0, 3000)}"""`,
      }) as Promise<ClassifyResult>;
    },
    freeBusy: busyIntervals,
    computeOpenSlots: (startIso, endIso, busy, now) => computeOpenSlots({ startIso, endIso, busy, now }),
    isSlotAcceptable(slotIso, busy, now) {
      const s = new Date(slotIso);
      if (isNaN(s.getTime()) || s < now) return false;
      if (s.getTime() > now.getTime() + config.bookingWindowDays * 86_400_000) return false;
      const z1 = zonedParts(s, config.timezone);
      if (z1.weekday === "Sat" || z1.weekday === "Sun") return false;
      const mins = z1.hh * 60 + z1.mm;
      const [sh, sm] = config.businessStart.split(":").map(Number);
      const [eh, em] = config.businessEnd.split(":").map(Number);
      if (mins < sh * 60 + sm || mins + config.meetingMinutes > eh * 60 + em) return false;
      const e = s.getTime() + config.meetingMinutes * 60_000;
      return !busy.some((b) => s.getTime() < new Date(b.end).getTime() && e > new Date(b.start).getTime());
    },
    pickTwoSlots: (slots, rejected) => pickTwoSlots(slots, rejected),
    formatSlot: (iso) => formatSlot(iso),
    // Double-booking guard: a meeting row for this company means it is already booked.
    findEvent: async (companyId) => {
      const [m] = await db().select().from(schema.meetings).where(eq(schema.meetings.companyId, companyId));
      return m ? { id: m.calendarEventId ?? `meeting-${m.id}` } : null;
    },
    async createEvent(s, slotIso) {
      const r = await bookSlot({ slotIso, contactName: s.contactName, companyId: s.companyId });
      await logEvent(s.companyId, "agent", "calendly_booking", { mode: r.mode, eventId: r.eventId, note: r.note });
      return { eventId: r.eventId, endIso: new Date(new Date(slotIso).getTime() + config.meetingMinutes * 60_000).toISOString() };
    },
    bookingLink: (slotIso) => (slotIso ? slotLink(slotIso) : config.calendlyUrl || null),
    async send(s, kind, body) {
      const c = await companyContext(s.companyId);
      const log = c.decisionLog as DecisionLog;
      const contact = log?.contact?.chosen;
      const subject = s.coldSubject ? (s.coldSubject.startsWith("Re:") ? s.coldSubject : `Re: ${s.coldSubject}`) : "Re: Sprinto";
      const dryRun = c.dryRun || config.dryRunEnv;
      body = normalizeBody(body, config.senderName, config.senderTitle);
      const r = await sendEmail({
        subject, body, threadId: s.gmailThreadId, inReplyTo: s.lastRfcMessageId, dryRun,
        intendedRecipient: { fullName: contact?.name ?? s.contactName, email: contact?.email ?? null, title: contact?.title ?? s.contactTitle, company: s.companyName },
      });
      await db().insert(schema.emails).values({
        companyId: s.companyId, kind, subject, body, sendStatus: r.status, gmailMessageId: r.messageId, gmailThreadId: r.threadId, rfcMessageId: r.rfcMessageId,
        sentAt: r.status === "send_failed" ? null : new Date(), dryRun,
      });
      await logEvent(s.companyId, "agent", r.status === "send_failed" ? "email_send_failed" : `email_${kind}`, { status: r.status, error: r.error });
      return { status: r.status === "send_failed" ? "failed" : r.status, messageId: r.messageId ?? (r.status === "dry_run" ? `dry-${Date.now()}` : null), rfcMessageId: r.rfcMessageId, error: r.error };
    },
    async draftFollowup(s, n) {
      const c = await companyContext(s.companyId);
      const log = c.decisionLog as DecisionLog;
      const facts = c.facts as Facts;
      const visited = new Set<PageType>(log.fetchTrail.map((t) => t.pageType).filter((p): p is PageType => p !== "news_feed"));
      const verdict = computeVerdict(facts, { now: new Date(), visited, newsFirstScreen: log.newsFirstScreen });
      const [cold] = await db().select().from(schema.emails).where(and(eq(schema.emails.companyId, s.companyId), eq(schema.emails.kind, "cold"))).orderBy(desc(schema.emails.id)).limit(1);
      const rules = await getActiveRules();
      const chosen = log.contact?.chosen;
      const [firstName, ...rest] = (chosen?.name ?? s.contactName).split(" ");
      const r = await draftFollowup({
        domain: c.domain, companyName: s.companyName, facts, verdict, contact: { firstName, lastName: rest.join(" ") || null, title: chosen?.title ?? s.contactTitle },
        painPoints: log.painPoints ?? [], rules: rules.map((x) => ({ id: x.id, kind: x.kind, text: x.text })), hookSummary: await hookSummary(),
        followupNumber: n, previousSubject: cold?.subject ?? s.coldSubject, previousBody: cold?.body ?? "", usedHookSignalId: cold?.hookSignalId ?? null,
      });
      await markRulesApplied(r.rulesApplied);
      await logEvent(s.companyId, "agent", `followup_${n}_drafted`, { hookSignalId: r.hookSignalId, rulesApplied: r.rulesApplied, qualityGate: r.qualityGate });
      return { body: r.body, passed: r.qualityGate.passed, failures: r.qualityGate.failures };
    },
    async draftFromInstruction(s, instruction) {
      const out = await generateJson({
        slot: "smart", purpose: "draft_from_instruction", temperature: 0.4, schema: z.object({ body: z.string() }),
        system: `Write a short plain-text email reply (<= ${EMAIL_LIMITS.REPLY_MAX_WORDS} words) in an ongoing sales thread, following the Growth Lead's instruction exactly. Start with "Hi ${s.contactName.split(" ")[0]}," and end with "${config.senderName}". Only claims about Sprinto: ${SPRINTO_FACTS.join("; ")}. Never use: ${BANNED_PHRASES.slice(0, 6).join(", ")}.`,
        prompt: `Instruction: ${instruction}\n\nProspect's last message:\n${s.lastReplyText ?? "(none)"}\n\nTimes we offered: ${s.timesProposed.map((t) => formatSlot(t)).join(" | ") || "none"}`,
      });
      return out.body;
    },
    async updateCrm(s, u) {
      const set: Partial<typeof schema.companies.$inferInsert> = { updatedAt: new Date() };
      if (u.status) set.status = u.status as typeof schema.companies.$inferInsert.status;
      if (u.backupReason !== undefined) set.backupReason = u.backupReason;
      if (u.revisitAfterMs) set.revisitAfter = new Date(Date.now() + u.revisitAfterMs);
      if (u.inputNeededReason !== undefined) set.inputNeededReason = u.inputNeededReason;
      if (u.status && u.status !== "INPUT_NEEDED") set.inputNeededReason = null;
      await db().update(schema.companies).set(set).where(eq(schema.companies.id, s.companyId));
      await db().update(schema.conversations).set({ stage: u.stage, inputNeededReason: u.inputNeededReason ?? null, lastActivityAt: new Date() }).where(eq(schema.conversations.companyId, s.companyId));
      await logEvent(s.companyId, "agent", u.event, { status: u.status, stage: u.stage, ...u.payload, backupReason: u.backupReason });
    },
    recordOutcome: (s, outcome) => recordHookOutcome(s.companyId, outcome),
    async saveMeeting(s, startIso, endIso, eventId) {
      const existing = await db().select().from(schema.meetings).where(eq(schema.meetings.companyId, s.companyId));
      if (!existing.length) await db().insert(schema.meetings).values({ companyId: s.companyId, startAt: new Date(startIso), endAt: new Date(endIso), calendarEventId: eventId });
    },
    async mirror(s) {
      const { history, ...rest } = s;
      await db().update(schema.conversations).set({ state: { ...rest, history: history.slice(-60) }, lastActivityAt: new Date(s.lastActivityAt) }).where(eq(schema.conversations.companyId, s.companyId));
    },
    errorKind: classifyCalendarError,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    config: {
      meetingMinutes: config.meetingMinutes, bookingWindowDays: config.bookingWindowDays, maxRounds: config.maxNegotiationRounds,
      followup1Ms: config.followup1AfterMs, followup2Ms: config.followup2AfterMs, backupNegativeMs: config.backupRevisitNegativeMs,
      backupNoReplyMs: config.backupRevisitNoReplyMs, senderName: config.senderName,
    },
  };
}

async function graph() {
  return buildGraph(realDeps(), await checkpointer());
}

/** LangGraph thread id = companyId (a re-approach after Backup gets a fresh "<companyId>-r<ts>" thread). */
async function threadCfg(companyId: number) {
  const [conv] = await db().select().from(schema.conversations).where(eq(schema.conversations.companyId, companyId));
  return { configurable: { thread_id: conv?.langgraphThreadId ?? String(companyId) } };
}

// ───────────── Public API ─────────────
export async function startConversation(p: { companyId: number; gmailThreadId: string | null; sentMessageId: string | null; rfcMessageId: string | null }) {
  const c = await companyContext(p.companyId);
  const log = c.decisionLog as DecisionLog;
  const contact = log.contact?.chosen;
  const priorOutcomes = await db().select().from(schema.events).where(and(eq(schema.events.companyId, p.companyId), eq(schema.events.type, "conversation_started")));
  const tid = priorOutcomes.length ? `${p.companyId}-r${Date.now()}` : String(p.companyId);
  await db().insert(schema.conversations).values({ companyId: p.companyId, gmailThreadId: p.gmailThreadId, langgraphThreadId: tid, stage: "waiting_for_reply", lastActivityAt: new Date() })
    .onConflictDoUpdate({ target: schema.conversations.companyId, set: { gmailThreadId: p.gmailThreadId, langgraphThreadId: tid, stage: "waiting_for_reply", state: null, inputNeededReason: null, lastActivityAt: new Date() } });
  const g = await graph();
  const init: Partial<State> = {
    companyId: p.companyId, domain: c.domain, companyName: c.name ?? c.domain, contactName: contact?.name ?? "", contactTitle: contact?.title ?? "",
    gmailThreadId: p.gmailThreadId, agentSentMessageIds: p.sentMessageId ? [p.sentMessageId] : [], lastRfcMessageId: p.rfcMessageId,
    lastActivityAt: new Date().toISOString(), coldSubject: log.email?.subject ?? "",
    history: [{ ts: new Date().toISOString(), node: "start", action: "cold_email_sent", result: p.gmailThreadId ?? "dry_run" }],
  };
  await g.invoke(init, await threadCfg(p.companyId));
  await mirrorFromGraph(p.companyId);
  await logEvent(p.companyId, "agent", "conversation_started", { gmailThreadId: p.gmailThreadId });
}

async function mirrorFromGraph(companyId: number) {
  const g = await graph();
  const st = await g.getState(await threadCfg(companyId));
  if (st?.values) await realDeps().mirror(st.values as State);
  return st;
}

/** Resume a paused conversation with an event. Returns false if the thread is not waiting. */
export async function resumeConversation(companyId: number, ev: ResumeEvent, actor: "agent" | "human" | "cron" = "agent") {
  const g = await graph();
  const st = await g.getState(await threadCfg(companyId));
  if (!st || !st.next?.length) return { resumed: false, reason: "conversation finished or not started" };
  await logEvent(companyId, actor, `resume_${ev.type}`, ev.type === "reply" ? { messageId: ev.messageId, text: ev.replyText.slice(0, 500) } : ev);
  await g.invoke(new Command({ resume: ev }), await threadCfg(companyId));
  const after = await mirrorFromGraph(companyId);
  return { resumed: true, state: after?.values as State };
}

export async function getConversationState(companyId: number) {
  const g = await graph();
  const st = await g.getState(await threadCfg(companyId));
  return { values: st?.values as State | undefined, next: st?.next ?? [] };
}

/**
 * Section 6.5: detect prospect replies over IMAP and resume their graphs.
 * A message from MY_EMAIL whose In-Reply-To/References contains one of the agent's Message-IDs
 * and is not itself an agent message (or already processed) is a prospect reply.
 */
export async function checkReplies() {
  const open = await db().select().from(schema.conversations).where(isNotNull(schema.conversations.gmailThreadId));
  const live: { companyId: number; ids: Set<string>; since: Date }[] = [];
  for (const conv of open) {
    const [c] = await db().select().from(schema.companies).where(eq(schema.companies.id, conv.companyId));
    if (!c || ["MEETING_BOOKED", "BACKUP", "DO_NOT_CONTACT"].includes(c.status)) continue;
    const { values, next } = await getConversationState(conv.companyId);
    if (!values || !next.length || values.inputNeeded || values.done) continue;
    live.push({ companyId: conv.companyId, ids: new Set([...values.agentSentMessageIds, ...values.processedMessageIds, conv.gmailThreadId!]), since: conv.createdAt });
  }
  if (!live.length) return [];
  const known = new Set(live.flatMap((l) => [...l.ids]));
  const since = new Date(Math.min(...live.map((l) => l.since.getTime())));
  const replies = await fetchReplies(since, known);
  const results: { companyId: number; processed: number; error?: string }[] = [];
  for (const l of live) {
    let processed = 0;
    try {
      for (const m of replies) {
        const refs = [m.inReplyTo, ...m.references].filter(Boolean) as string[];
        if (!refs.some((r) => l.ids.has(r))) continue;
        const cur = (await getConversationState(l.companyId)).values!;
        if (cur.agentSentMessageIds.includes(m.id) || cur.processedMessageIds.includes(m.id)) continue;
        if (cur.inputNeeded || cur.done) break;
        await resumeConversation(l.companyId, { type: "reply", replyText: stripQuoted(m.text) || "(empty reply)", messageId: m.id, receivedAt: m.date.toISOString(), rfcMessageId: m.id });
        processed++;
      }
      results.push({ companyId: l.companyId, processed });
    } catch (e) {
      results.push({ companyId: l.companyId, processed, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  return results;
}

/** Daily job: replies, due follow-ups, stale threads → Backup, re-queue Backup/Nurture past revisit date. */
export async function runDailyJobs(actor: "cron" | "human" = "cron") {
  const replies = await checkReplies().catch((e) => [{ error: String(e) }]);
  const ticks: { companyId: number; result: string }[] = [];
  const convs = await db().select().from(schema.conversations);
  for (const conv of convs) {
    try {
      const { values, next } = await getConversationState(conv.companyId);
      if (!values || !next.length || values.inputNeeded || values.done) continue;
      const r = await resumeConversation(conv.companyId, { type: "no_reply_check" }, actor);
      ticks.push({ companyId: conv.companyId, result: r.resumed ? (r.state?.history.slice(-1)[0]?.action ?? "checked") : r.reason ?? "" });
    } catch (e) {
      ticks.push({ companyId: conv.companyId, result: `error: ${String(e).slice(0, 150)}` });
    }
  }
  // Re-queue Backup / Nurture companies whose revisit date has passed.
  const due = await db().select().from(schema.companies).where(and(inArray(schema.companies.status, ["BACKUP", "NURTURE"]), lte(schema.companies.revisitAfter, new Date())));
  for (const c of due) {
    await db().update(schema.companies).set({ status: "QUEUED", revisitAfter: null, resumeFrom: null, updatedAt: new Date() }).where(eq(schema.companies.id, c.id));
    await db().delete(schema.conversations).where(eq(schema.conversations.companyId, c.id));
    await logEvent(c.id, actor, "requeued_after_revisit", { previousStatus: c.status, backupReason: c.backupReason });
  }
  await logEvent(null, actor, "daily_jobs_ran", { replies, ticks, requeued: due.map((d) => d.domain) });
  return { replies, ticks, requeued: due.map((d) => d.domain) };
}
