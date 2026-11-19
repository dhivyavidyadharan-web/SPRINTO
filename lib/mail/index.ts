/**
 * Email over Gmail SMTP + IMAP with a Google App Password (no OAuth / Cloud project needed).
 *
 * LIVE TEST MODE: every email goes to MY_EMAIL. There is no code path that emails a prospect.
 * sendEmail sets `to` itself and throws if any other recipient is passed.
 */
import { randomUUID } from "crypto";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { config } from "../env";
import { toHtml } from "./layout";

export class RecipientNotAllowedError extends Error {}

export function assertRecipient(to: string | undefined): string {
  const mine = config.myEmail;
  if (!mine) throw new RecipientNotAllowedError("MY_EMAIL is not configured — refusing to send.");
  if (to !== undefined && to.trim().toLowerCase() !== mine) {
    throw new RecipientNotAllowedError(`Refusing to send to "${to}": live test mode only allows MY_EMAIL.`);
  }
  return mine;
}

export interface IntendedRecipient { fullName: string; email: string | null; title: string | null; company: string }

export function liveTestFooter(r: IntendedRecipient) {
  return `\n\n— Live test. Intended recipient: ${r.fullName} <${r.email ?? "unknown"}>, ${r.title ?? "unknown title"} at ${r.company}`;
}

export function newMessageId() {
  const host = (config.myEmail.split("@")[1] || "sprinto-agent.local").toLowerCase();
  return `<sprinto-${randomUUID()}@${host}>`;
}

/** Link that opens a message in Gmail by its RFC Message-ID. */
export function gmailLink(rfcMessageId: string | null | undefined) {
  if (!rfcMessageId) return null;
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`rfc822msgid:${rfcMessageId.replace(/[<>]/g, "")}`)}`;
}

export interface SendParams {
  subject: string;
  body: string;
  /** RFC Message-ID of the first email in the thread (our thread key). */
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  /** Only for the safety assertion: must be undefined or MY_EMAIL. */
  to?: string;
  intendedRecipient?: IntendedRecipient;
  dryRun?: boolean;
}

export interface SendResult {
  status: "sent" | "dry_run" | "send_failed";
  /** RFC Message-ID of the sent message. */
  messageId: string | null;
  /** Thread key = RFC Message-ID of the thread's first message. */
  threadId: string | null;
  rfcMessageId: string | null;
  finalBody: string;
  attempts: number;
  error?: string;
}

export interface OutgoingMail { from: string; to: string; subject: string; text: string; html?: string; messageId: string; inReplyTo?: string; references?: string }
export type SmtpSend = (m: OutgoingMail) => Promise<void>;

let smtpSend: SmtpSend = async (m) => {
  if (!config.gmailAppPassword) throw new Error("GMAIL_APP_PASSWORD is not set");
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: config.gmailUser, pass: config.gmailAppPassword },
    connectionTimeout: 15_000, socketTimeout: 20_000,
  });
  await t.sendMail({
    from: { name: config.senderName, address: m.from }, to: m.to, subject: m.subject, text: m.text, html: m.html,
    messageId: m.messageId, inReplyTo: m.inReplyTo, references: m.references,
  });
};
/** Test hook: replace the SMTP transport. */
export function __setSmtpSend(f: SmtpSend) { smtpSend = f; }

function isTransient(e: unknown) {
  const code = (e as { responseCode?: number })?.responseCode;
  return (typeof code === "number" && code >= 400 && code < 500) // SMTP 4xx = temporary
    || /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket|EAI_AGAIN|greeting/i.test(String((e as Error)?.message ?? e));
}

export async function sendEmail(p: SendParams): Promise<SendResult> {
  const to = assertRecipient(p.to); // throws for any non-MY_EMAIL recipient
  const footer = p.intendedRecipient ? liveTestFooter(p.intendedRecipient) : "";
  const finalBody = `${p.body}${footer}`;
  const html = toHtml(p.body, footer.replace(/^\s*—\s*/, "") || undefined);
  const messageId = newMessageId();
  const threadId = p.threadId ?? messageId;
  if (p.dryRun || config.dryRunEnv) {
    return { status: "dry_run", messageId: null, threadId: p.threadId ?? null, rfcMessageId: null, finalBody, attempts: 0 };
  }
  const references = [p.references, p.threadId !== p.inReplyTo ? p.threadId : null, p.inReplyTo].filter(Boolean).join(" ") || undefined;
  let attempts = 0;
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) { // 1 try + 2 retries on transient errors
    attempts++;
    try {
      await smtpSend({ from: config.gmailUser || to, to, subject: p.subject, text: finalBody, html, messageId, inReplyTo: p.inReplyTo ?? undefined, references });
      return { status: "sent", messageId, threadId, rfcMessageId: messageId, finalBody, attempts };
    } catch (e) {
      lastErr = e;
      if (!isTransient(e) || i === 2) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  return { status: "send_failed", messageId: null, threadId: p.threadId ?? null, rfcMessageId: null, finalBody, attempts, error: String((lastErr as Error)?.message ?? lastErr).slice(0, 300) };
}

// ───────────── Reading replies over IMAP ─────────────

export interface InboundMessage { id: string; inReplyTo: string | null; references: string[]; date: Date; text: string; subject: string }

function idsIn(v: unknown): string[] {
  if (!v) return [];
  const s = Array.isArray(v) ? v.join(" ") : String(v);
  return s.match(/<[^>]+>/g) ?? [];
}

/**
 * Fetch messages from MY_EMAIL received since `since` that reply to any of `knownIds`.
 * Uses "All Mail" (one copy of self-sent messages), falling back to INBOX.
 */
export async function fetchReplies(since: Date, knownIds: Set<string>): Promise<InboundMessage[]> {
  if (!config.gmailAppPassword) throw new Error("GMAIL_APP_PASSWORD is not set");
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: config.gmailUser, pass: config.gmailAppPassword }, logger: false });
  await client.connect();
  try {
    const boxes = await client.list();
    const all = boxes.find((b) => b.specialUse === "\\All")?.path ?? "INBOX";
    const lock = await client.getMailboxLock(all);
    try {
      const uids = await client.search({ since: new Date(since.getTime() - 86_400_000), from: config.myEmail }, { uid: true });
      if (!uids || !uids.length) return [];
      const heads = await client.fetchAll(uids.slice(-300), { uid: true, envelope: true, headers: ["in-reply-to", "references"] }, { uid: true });
      const matches = heads.filter((m) => {
        const h = m.headers?.toString("utf8") ?? "";
        return idsIn(h).some((id) => knownIds.has(id));
      });
      const out: InboundMessage[] = [];
      for (const m of matches) {
        const full = await client.fetchOne(String(m.uid), { source: true }, { uid: true });
        if (!full || !full.source) continue;
        const parsed = await simpleParser(full.source);
        const id = parsed.messageId ?? m.envelope?.messageId ?? `uid-${m.uid}`;
        if (knownIds.has(id)) continue; // our own message
        out.push({
          id, inReplyTo: idsIn(parsed.inReplyTo)[0] ?? null, references: idsIn(parsed.references),
          date: new Date(parsed.date ?? m.envelope?.date ?? Date.now()), text: parsed.text ?? "", subject: parsed.subject ?? "",
        });
      }
      return out.sort((a, b) => a.date.getTime() - b.date.getTime());
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** Connectivity check for the Settings page: SMTP auth + IMAP login. */
export async function testMailConnection(): Promise<{ smtp: string; imap: string }> {
  const res = { smtp: "not configured", imap: "not configured" };
  if (!config.gmailAppPassword) return res;
  try {
    const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: config.gmailUser, pass: config.gmailAppPassword }, connectionTimeout: 10_000 });
    await t.verify();
    res.smtp = "ok";
  } catch (e) { res.smtp = `error: ${String((e as Error).message).slice(0, 160)}`; }
  try {
    const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: config.gmailUser, pass: config.gmailAppPassword }, logger: false });
    await c.connect(); await c.logout();
    res.imap = "ok";
  } catch (e) { res.imap = `error: ${String((e as Error).message).slice(0, 160)}`; }
  return res;
}

/** Strip quoted text: lines starting with ">" and everything after "On … wrote:". */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*On .{3,200}wrote:\s*$/.test(l)) break;
    if (/^\s*On .{3,200}$/.test(l) && /wrote:\s*$/.test(lines[i + 1] ?? "")) break;
    if (/^-{2,}\s*Original Message/i.test(l) || (/^From: .+/.test(l) && out.length > 0)) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n").replace(/\n—\s*Live test\. Intended recipient:.*$/s, "").trim();
}
