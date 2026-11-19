/** Read models for the dashboard: cold deals and the feedback queue. */
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import type { DecisionLog } from "./pipeline/decisionLog";

export type ColdKind = "declined" | "no_reply" | "cooling" | "nurture" | "parked" | "unsubscribed";

export const COLD_LABELS: Record<ColdKind, { label: string; hint: string }> = {
  declined: { label: "Declined", hint: "Replied no — parked with a revisit date" },
  no_reply: { label: "No reply", hint: "Silent after the cold email and both follow-ups" },
  cooling: { label: "Cooling", hint: "Follow-ups sent, still no reply" },
  nurture: { label: "Not ready", hint: "Right company, no buying signal yet" },
  parked: { label: "Parked by you", hint: "Moved to Backup manually" },
  unsubscribed: { label: "Unsubscribed", hint: "Asked not to be contacted" },
};

const DECLINE_REASONS: Record<string, string> = {
  not_now: "Not now", no_need: "No need", using_competitor: "Using a competitor", no_budget: "No budget", other: "Other",
  no_reply: "No reply", human_moved: "Moved by you", no_timing_signal: "No timing signal",
};

export interface ColdDeal {
  companyId: number;
  domain: string;
  name: string;
  kind: ColdKind;
  reason: string;
  contact: string | null;
  contactTitle: string | null;
  score: number | null;
  emailsSent: number;
  lastReply: string | null;
  lastActivity: Date;
  revisitAfter: Date | null;
}

function kindOf(status: string, backupReason: string | null): ColdKind {
  if (status === "FOLLOWUP_1_SENT" || status === "FOLLOWUP_2_SENT") return "cooling";
  if (status === "NURTURE") return "nurture";
  if (status === "DO_NOT_CONTACT") return "unsubscribed";
  if (backupReason === "no_reply") return "no_reply";
  if (backupReason === "human_moved") return "parked";
  return "declined";
}

export async function coldDeals(): Promise<ColdDeal[]> {
  const rows = await db().select().from(schema.companies)
    .where(inArray(schema.companies.status, ["BACKUP", "FOLLOWUP_1_SENT", "FOLLOWUP_2_SENT", "NURTURE", "DO_NOT_CONTACT"]))
    .orderBy(desc(schema.companies.updatedAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const convs = await db().select().from(schema.conversations).where(inArray(schema.conversations.companyId, ids));
  const sent = await db().execute(sql`SELECT company_id, count(*)::int AS n FROM emails WHERE send_status IN ('sent','dry_run') AND company_id IN ${sql.raw(`(${ids.join(",")})`)} GROUP BY company_id`);
  const sentBy = new Map((sent.rows as { company_id: number; n: number }[]).map((r) => [r.company_id, r.n]));
  const convBy = new Map(convs.map((c) => [c.companyId, c]));
  return rows.map((c) => {
    const log = c.decisionLog as DecisionLog | null;
    const conv = convBy.get(c.id);
    const st = conv?.state as { lastReplyText?: string | null } | null;
    const kind = kindOf(c.status, c.backupReason);
    const reason = kind === "cooling"
      ? (c.status === "FOLLOWUP_2_SENT" ? "2 follow-ups, no reply" : "1 follow-up, no reply")
      : kind === "unsubscribed" ? "Asked to stop" : DECLINE_REASONS[c.backupReason ?? ""] ?? (c.backupReason ?? "—");
    return {
      companyId: c.id, domain: c.domain, name: c.name ?? c.domain, kind, reason,
      contact: log?.contact?.chosen?.name ?? null, contactTitle: log?.contact?.chosen?.title ?? null,
      score: c.score, emailsSent: sentBy.get(c.id) ?? 0, lastReply: st?.lastReplyText ?? null,
      lastActivity: conv?.lastActivityAt ?? c.updatedAt, revisitAfter: c.revisitAfter,
    };
  });
}

export interface FeedbackItem {
  emailId: number; companyId: number; domain: string; companyName: string; kind: string;
  subject: string; body: string; sentAt: Date | null; hookSignalId: string | null; rulesApplied: string[];
  contact: string | null;
}

/** Sent cold emails / follow-ups that have no feedback yet (newest first). */
export async function feedbackQueue(limit = 20): Promise<{ pending: FeedbackItem[]; reviewed: number }> {
  const reviewedIds = (await db().select({ id: schema.feedback.emailId }).from(schema.feedback)).map((r) => r.id);
  const rows = await db().select({ e: schema.emails, c: schema.companies }).from(schema.emails)
    .innerJoin(schema.companies, eq(schema.emails.companyId, schema.companies.id))
    .where(and(
      inArray(schema.emails.kind, ["cold", "followup_1", "followup_2"]),
      inArray(schema.emails.sendStatus, ["sent", "dry_run"]),
      reviewedIds.length ? notInArray(schema.emails.id, reviewedIds) : sql`true`,
    ))
    .orderBy(desc(schema.emails.id)).limit(limit);
  return {
    reviewed: new Set(reviewedIds).size,
    pending: rows.map(({ e, c }) => ({
      emailId: e.id, companyId: c.id, domain: c.domain, companyName: c.name ?? c.domain, kind: e.kind,
      subject: e.subject, body: e.body, sentAt: e.sentAt, hookSignalId: e.hookSignalId, rulesApplied: e.rulesApplied,
      contact: (c.decisionLog as DecisionLog | null)?.contact?.chosen?.name ?? null,
    })),
  };
}
