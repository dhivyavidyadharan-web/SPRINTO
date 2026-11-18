import { google } from "googleapis";
import { config } from "../env";
import { authedClient } from "./auth";

/**
 * LIVE TEST MODE: every email goes to MY_EMAIL. There is no code path that emails a prospect.
 * sendEmail sets `to` itself and throws if any other recipient is passed.
 */
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

function encodeHeader(s: string) {
  return /[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=` : s;
}

export function buildRawMessage(p: { to: string; from: string; subject: string; body: string; inReplyTo?: string | null; references?: string | null }) {
  const headers = [
    `From: ${encodeHeader(config.senderName)} <${p.from}>`,
    `To: ${p.to}`,
    `Subject: ${encodeHeader(p.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  if (p.inReplyTo) headers.push(`In-Reply-To: ${p.inReplyTo}`, `References: ${p.references ?? p.inReplyTo}`);
  const msg = `${headers.join("\r\n")}\r\n\r\n${p.body.replace(/\r?\n/g, "\r\n")}`;
  return Buffer.from(msg, "utf8").toString("base64url");
}

export interface SendParams {
  subject: string;
  body: string;
  threadId?: string | null;
  inReplyTo?: string | null; // RFC Message-ID of the message being replied to
  references?: string | null;
  /** Only for the safety assertion: must be undefined or MY_EMAIL. */
  to?: string;
  intendedRecipient?: IntendedRecipient;
  dryRun?: boolean;
}

export interface SendResult {
  status: "sent" | "dry_run" | "send_failed";
  messageId: string | null;
  threadId: string | null;
  rfcMessageId: string | null;
  finalBody: string;
  attempts: number;
  error?: string;
}

type GmailApi = ReturnType<typeof google.gmail>;
let gmailFactory: () => Promise<GmailApi> = async () => google.gmail({ version: "v1", auth: await authedClient() });
/** Test hook: replace the Gmail client. */
export function __setGmailFactory(f: () => Promise<GmailApi>) { gmailFactory = f; }

function isTransient(e: unknown) {
  const code = (e as { code?: number; status?: number })?.code ?? (e as { status?: number })?.status;
  return (typeof code === "number" && code >= 500) || /timeout|ETIMEDOUT|ECONNRESET|socket hang up|fetch failed/i.test(String(e));
}

export async function sendEmail(p: SendParams): Promise<SendResult> {
  const to = assertRecipient(p.to); // throws for any non-MY_EMAIL recipient
  const finalBody = p.intendedRecipient ? `${p.body}${liveTestFooter(p.intendedRecipient)}` : p.body;
  if (p.dryRun || config.dryRunEnv) {
    return { status: "dry_run", messageId: null, threadId: p.threadId ?? null, rfcMessageId: null, finalBody, attempts: 0 };
  }
  const raw = buildRawMessage({ to, from: to, subject: p.subject, body: finalBody, inReplyTo: p.inReplyTo, references: p.references });
  let attempts = 0;
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    attempts++;
    try {
      const gmail = await gmailFactory();
      const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId: p.threadId ?? undefined } });
      const id = res.data.id ?? null;
      let rfc: string | null = null;
      try {
        const m = await gmail.users.messages.get({ userId: "me", id: id!, format: "metadata", metadataHeaders: ["Message-ID", "Message-Id"] });
        rfc = m.data.payload?.headers?.find((h) => /^message-id$/i.test(h.name ?? ""))?.value ?? null;
      } catch { /* non-fatal */ }
      return { status: "sent", messageId: id, threadId: res.data.threadId ?? null, rfcMessageId: rfc, finalBody, attempts };
    } catch (e) {
      lastErr = e;
      if (!isTransient(e) || i === 2) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  return { status: "send_failed", messageId: null, threadId: p.threadId ?? null, rfcMessageId: null, finalBody, attempts, error: String((lastErr as Error)?.message ?? lastErr).slice(0, 300) };
}

export interface ThreadMessage { id: string; rfcMessageId: string | null; from: string; date: string; internalDate: number; text: string }

export async function getThreadMessages(threadId: string): Promise<ThreadMessage[]> {
  const gmail = await gmailFactory();
  const t = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  return (t.data.messages ?? []).map((m) => {
    const h = (n: string) => m.payload?.headers?.find((x) => x.name?.toLowerCase() === n)?.value ?? "";
    return { id: m.id!, rfcMessageId: h("message-id") || null, from: h("from"), date: h("date"), internalDate: Number(m.internalDate ?? 0), text: extractPlainText(m.payload) };
  });
}

type Part = { mimeType?: string | null; body?: { data?: string | null } | null; parts?: Part[] | null };
function extractPlainText(p: Part | undefined | null): string {
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8");
  for (const c of p.parts ?? []) { const t = extractPlainText(c); if (t) return t; }
  if (p.mimeType === "text/html" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8").replace(/<[^>]+>/g, " ");
  return "";
}

/** Strip quoted text: lines starting with ">" and everything after "On … wrote:". */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const joined = `${l} ${lines[i + 1] ?? ""}`;
    if (/^\s*On .{3,200}wrote:\s*$/.test(l) || /^\s*On .{3,200}wrote:\s*$/.test(joined.trim()) && /wrote:\s*$/.test(lines[i + 1] ?? "")) break;
    if (/^-{2,}\s*Original Message/i.test(l) || /^From: .+/.test(l) && out.length > 0) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n").replace(/\n—\s*Live test\. Intended recipient:.*$/s, "").trim();
}
