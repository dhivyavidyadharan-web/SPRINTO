import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { Company } from "../db/schema";
import { config } from "../env";
import { TokenMeter } from "../llm/gemini";
import { logEvent } from "../db/events";
import { Scraper, type PageResult } from "../scrape/fetch";
import { SCRAPE, computeVerdict, type PageType, type VerdictResult } from "../rubric";
import type { Facts } from "../facts";
import { runQualificationLoop } from "./qualify";
import { extractFacts } from "./extract";
import { explainVerdict } from "./explain";
import { findDecisionMaker } from "./contacts";
import { choosePainPoints, type PainPoint } from "./painPoints";
import { draftColdEmail } from "./draft";
import { emptyLog, type DecisionLog } from "./decisionLog";
import { sendEmail } from "../google/gmail";
import { getActiveRules, hookSummary, markRulesApplied } from "../feedback";
import { startConversation } from "../agent/runtime";

export interface StepResult { done: boolean; companyId?: number; domain?: string; status?: string; detail?: string; tokens?: number; costUsd?: number }

/** Atomically claim the oldest QUEUED company. */
async function claimNext(): Promise<Company | null> {
  const res = await db().execute(sql`
    UPDATE companies SET status = 'PROCESSING', updated_at = now()
    WHERE id = (SELECT id FROM companies WHERE status = 'QUEUED' ORDER BY updated_at ASC, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id`);
  const id = (res.rows?.[0] as { id?: number } | undefined)?.id;
  if (!id) return null;
  const [c] = await db().select().from(schema.companies).where(eq(schema.companies.id, id));
  return c ?? null;
}

async function setStatus(id: number, status: Company["status"], extra: Partial<typeof schema.companies.$inferInsert> = {}) {
  await db().update(schema.companies).set({ status, updatedAt: new Date(), ...extra }).where(eq(schema.companies.id, id));
}

/** Process exactly one company per call (keeps each request well under 60 s). */
export async function pipelineStep(): Promise<StepResult> {
  const c = await claimNext();
  if (!c) return { done: true };
  const meter = new TokenMeter();
  const log: DecisionLog = (c.resumeFrom && c.decisionLog) ? (c.decisionLog as DecisionLog) : emptyLog(c.domain);
  if (!c.resumeFrom) log.runAt = new Date().toISOString();
  await logEvent(c.id, "pipeline", "processing_started", { resumeFrom: c.resumeFrom });
  try {
    const status = await processCompany(c, log, meter);
    return { done: false, companyId: c.id, domain: c.domain, status, tokens: meter.tokensIn + meter.tokensOut, costUsd: meter.estCostUsd };
  } catch (e) {
    const msg = String((e as Error)?.stack ?? e).slice(0, 1500);
    log.errors.push(msg);
    finalizeTokens(log, meter);
    // The queue never stalls: failure → company gets a status.
    await setStatus(c.id, "INPUT_NEEDED", { decisionLog: log, inputNeededReason: `pipeline_error: ${String((e as Error)?.message ?? e).slice(0, 200)}`, resumeFrom: null });
    await logEvent(c.id, "pipeline", "pipeline_error", { error: msg.slice(0, 500) });
    return { done: false, companyId: c.id, domain: c.domain, status: "INPUT_NEEDED", detail: String(e).slice(0, 200) };
  }
}

function finalizeTokens(log: DecisionLog, meter: TokenMeter) {
  log.tokens = { in: (log.tokens?.in ?? 0) + meter.tokensIn, out: (log.tokens?.out ?? 0) + meter.tokensOut };
  log.estCostUsd = Math.round(((log.estCostUsd ?? 0) + meter.estCostUsd) * 10000) / 10000;
}

async function processCompany(c: Company, log: DecisionLog, meter: TokenMeter): Promise<Company["status"]> {
  let facts: Facts;
  let verdict: VerdictResult;

  if (c.resumeFrom === "contacts" || c.resumeFrom === "override_qualified") {
    // Resume from Step 4 using stored facts (contact uploaded, or human override of a gate-unknown verdict).
    facts = c.facts as Facts;
    const visited = new Set<PageType>(log.fetchTrail.map((t) => t.pageType));
    verdict = computeVerdict(facts, { now: new Date(), visited });
    if (c.resumeFrom === "override_qualified" && verdict.verdict !== "QUALIFIED") {
      verdict = { ...verdict, verdict: "QUALIFIED", flags: [...verdict.flags, "human_override"] };
      log.verdict = "QUALIFIED"; log.flags = verdict.flags;
      log.overrides = [...(log.overrides ?? []), { ts: new Date().toISOString(), action: "override_qualified" }];
    }
    await db().update(schema.companies).set({ resumeFrom: null }).where(eq(schema.companies.id, c.id));
  } else {
    // ── Steps 1–3: scrape → extract → qualify loop
    const scraper = new Scraper(config.maxHttpRequests);
    const loop = await runQualificationLoop(c.domain, {
      maxExtraFetches: config.maxExtraFetches,
      fetchPage: (url, pageType) => cachedFetch(scraper, c.id, url, pageType),
      extract: (url, pageType, cleaned) => extractFacts({ url, pageType, cleaned, domain: c.domain, meter }),
    });
    log.fetchTrail = loop.trail;
    log.httpRequests = scraper.httpRequests;
    log.stopReason = loop.stopReason;
    if (loop.outcome === "unreachable") {
      log.verdict = "UNREACHABLE";
      log.verdictReason = `Could not read the site: ${loop.unreachableReason}. Bot walls, logins and CAPTCHAs are never bypassed.`;
      finalizeTokens(log, meter);
      await setStatus(c.id, "UNREACHABLE", { verdict: "UNREACHABLE", decisionLog: log, backupReason: loop.unreachableReason ?? null });
      await logEvent(c.id, "pipeline", "unreachable", { reason: loop.unreachableReason });
      return "UNREACHABLE";
    }
    facts = loop.facts;
    verdict = loop.verdict!;
    log.verdict = verdict.verdict;
    log.score = verdict.score;
    log.flags = verdict.flags;
    log.gates = verdict.gates;
    log.signals = verdict.signals;
    log.codeRationale = verdict.rationale;
    log.inputNeededReason = verdict.inputNeededReason;
    log.verdictReason = await explainVerdict(c.domain, verdict, meter);
    await db().update(schema.companies).set({
      name: facts.companyName.value ?? c.name, facts, verdict: verdict.verdict, score: verdict.score, flags: verdict.flags, decisionLog: log,
    }).where(eq(schema.companies.id, c.id));
    await logEvent(c.id, "pipeline", "qualified_verdict", { verdict: verdict.verdict, score: verdict.score, flags: verdict.flags, fetched: loop.trail.map((t) => t.pageType) });

    if (verdict.verdict === "DISQUALIFIED") {
      finalizeTokens(log, meter);
      await setStatus(c.id, "DISQUALIFIED", { decisionLog: log });
      return "DISQUALIFIED";
    }
    if (verdict.verdict === "NURTURE") {
      finalizeTokens(log, meter);
      await setStatus(c.id, "NURTURE", { decisionLog: log, revisitAfter: new Date(Date.now() + config.nurtureRevisitMs), backupReason: "no_timing_signal" });
      return "NURTURE";
    }
    if (verdict.verdict === "INPUT_NEEDED") {
      finalizeTokens(log, meter);
      await setStatus(c.id, "INPUT_NEEDED", { decisionLog: log, inputNeededReason: verdict.inputNeededReason });
      await logEvent(c.id, "pipeline", "input_needed", { reason: verdict.inputNeededReason });
      return "INPUT_NEEDED";
    }
  }

  // ── Step 4: decision-maker
  const dm = await findDecisionMaker(c.domain, facts);
  const chosen = dm.chosen;
  log.contact = {
    chosen: chosen ? { name: [chosen.firstName, chosen.lastName].filter(Boolean).join(" "), title: chosen.title, email: chosen.email, linkedinUrl: chosen.linkedinUrl, source: chosen.source } : null,
    ruleUsed: dm.ruleUsed, provider: dm.provider, candidatesCount: dm.candidatesCount, rejected: dm.rejected,
  };
  if (!chosen) {
    finalizeTokens(log, meter);
    await setStatus(c.id, "INPUT_NEEDED", { decisionLog: log, inputNeededReason: "no_contact_found: upload a contact for this domain" });
    await logEvent(c.id, "pipeline", "input_needed", { reason: "no_contact_found", candidates: dm.candidatesCount });
    return "INPUT_NEEDED";
  }
  await logEvent(c.id, "pipeline", "contact_chosen", { name: log.contact.chosen?.name, title: chosen.title, rule: dm.ruleUsed });

  // ── Step 5: pain points
  const pp = await choosePainPoints({ domain: c.domain, facts, verdict, contactTitle: chosen.title ?? "", meter });
  log.painPoints = pp.painPoints;
  log.painPointsRejected = pp.rejected;

  // ── Step 6: draft + quality gate
  const companyName = facts.companyName.value ?? c.name ?? c.domain;
  const rules = await getActiveRules();
  const draft = await draftColdEmail({
    domain: c.domain, companyName, facts, verdict, meter,
    contact: { firstName: chosen.firstName!, lastName: chosen.lastName, title: chosen.title ?? "" },
    painPoints: pp.painPoints, rules: rules.map((r) => ({ id: r.id, kind: r.kind, text: r.text })), hookSummary: await hookSummary(),
  });
  log.email = { subject: draft.subject, body: draft.body, hookSignalId: draft.hookSignalId, hookQuote: draft.hookQuote, rulesApplied: draft.rulesApplied, painPointIdsUsed: draft.painPointIdsUsed, qualityGate: draft.qualityGate };
  const [emailRow] = await db().insert(schema.emails).values({
    companyId: c.id, kind: "cold", subject: draft.subject, body: draft.body, hookSignalId: draft.hookSignalId, hookQuote: draft.hookQuote,
    painPointIds: pp.painPoints.map((p) => p.id), rulesApplied: draft.rulesApplied, qualityGate: draft.qualityGate, sendStatus: "draft",
  }).returning();
  await markRulesApplied(draft.rulesApplied);

  if (!draft.qualityGate.passed) {
    finalizeTokens(log, meter);
    await setStatus(c.id, "INPUT_NEEDED", { decisionLog: log, inputNeededReason: "email_failed_quality_gate" });
    await logEvent(c.id, "pipeline", "input_needed", { reason: "email_failed_quality_gate", failures: draft.qualityGate.failures });
    return "INPUT_NEEDED";
  }
  finalizeTokens(log, meter);
  await setStatus(c.id, "QUALIFIED", { decisionLog: log });

  // ── Step 7: send
  return sendColdEmail(c.id, emailRow.id);
}

/** Send a stored cold email (also used by "Retry" in the Input-needed queue). */
export async function sendColdEmail(companyId: number, emailId?: number): Promise<Company["status"]> {
  const [c] = await db().select().from(schema.companies).where(eq(schema.companies.id, companyId));
  const log = c.decisionLog as DecisionLog;
  const emailRows = emailId
    ? await db().select().from(schema.emails).where(eq(schema.emails.id, emailId))
    : await db().select().from(schema.emails).where(and(eq(schema.emails.companyId, companyId), eq(schema.emails.kind, "cold"))).orderBy(desc(schema.emails.id)).limit(1);
  const e = emailRows[0];
  if (!e) throw new Error("no cold email draft to send");
  const contact = log.contact?.chosen;
  const dryRun = c.dryRun || config.dryRunEnv;
  const res = await sendEmail({
    subject: e.subject, body: e.body, dryRun,
    intendedRecipient: { fullName: contact?.name ?? "unknown", email: contact?.email ?? null, title: contact?.title ?? null, company: c.name ?? c.domain },
  });
  log.send = { status: res.status, messageId: res.messageId, threadId: res.threadId, dryRun, error: res.error };
  await db().update(schema.emails).set({
    sendStatus: res.status, gmailMessageId: res.messageId, gmailThreadId: res.threadId, rfcMessageId: res.rfcMessageId,
    sentAt: res.status === "send_failed" ? null : new Date(), dryRun, body: e.body,
  }).where(eq(schema.emails.id, e.id));
  await logEvent(companyId, "pipeline", res.status === "send_failed" ? "send_failed" : "cold_email_sent", { subject: e.subject, ...log.send });

  if (res.status === "send_failed") {
    log.errors.push(`send_failed: ${res.error}`);
    await setStatus(companyId, "QUALIFIED", { decisionLog: log, inputNeededReason: null });
    return "QUALIFIED";
  }
  await setStatus(companyId, "EMAILED", { decisionLog: log, inputNeededReason: null });
  await startConversation({ companyId, gmailThreadId: res.threadId, sentMessageId: res.messageId, rfcMessageId: res.rfcMessageId });
  return "EMAILED";
}

/** Page cache: reuse a successfully fetched non-homepage page if < 7 days old; store every fetch. */
async function cachedFetch(scraper: Scraper, companyId: number, url: string, pageType: PageType): Promise<PageResult> {
  if (pageType !== "homepage") {
    const since = new Date(Date.now() - SCRAPE.CACHE_DAYS * 86_400_000);
    const hit = await db().select().from(schema.pages).where(and(eq(schema.pages.url, url), eq(schema.pages.status, "ok"), gt(schema.pages.fetchedAt, since))).orderBy(desc(schema.pages.id)).limit(1);
    if (hit[0]?.cleanedText) {
      const h = hit[0];
      return { url, finalUrl: url, method: h.method as "fetch" | "jina", status: "ok", cleaned: { mainText: h.cleanedText!, footerText: h.footerText ?? "", badgeHints: h.badgeHints, links: [], title: "", wordCount: h.wordCount }, note: "cache" };
    }
  }
  const r = await scraper.fetchPage(url);
  await db().insert(schema.pages).values({
    companyId, url: r.finalUrl || url, pageType, method: r.method, status: r.status,
    cleanedText: r.cleaned?.mainText ?? null, footerText: r.cleaned?.footerText ?? null, badgeHints: r.cleaned?.badgeHints ?? [], wordCount: r.cleaned?.wordCount ?? 0,
  });
  return r;
}

/** Add domains to the queue (re-queues existing ones that are in a terminal pre-email state). */
export async function enqueueDomains(domains: string[], dryRun: boolean) {
  const added: string[] = []; const skipped: { domain: string; status: string }[] = [];
  for (const d of domains) {
    const [existing] = await db().select().from(schema.companies).where(eq(schema.companies.domain, d));
    if (existing) {
      if (["DISQUALIFIED", "NURTURE", "UNREACHABLE", "INPUT_NEEDED", "QUALIFIED"].includes(existing.status)) {
        await setStatus(existing.id, "QUEUED", { dryRun, resumeFrom: null, inputNeededReason: null });
        added.push(d);
      } else skipped.push({ domain: d, status: existing.status });
      continue;
    }
    const [row] = await db().insert(schema.companies).values({ domain: d, status: "QUEUED", dryRun }).returning();
    await logEvent(row.id, "human", "enqueued", { dryRun });
    added.push(d);
  }
  return { added, skipped };
}
