/**
 * Email layout. The model writes the *parts* of an email; code owns the layout so every email
 * reads the same way in Gmail:
 *
 *   Hi Macgill,
 *
 *   <hook — one specific observation>
 *
 *   <pain — why it matters for their role>
 *
 *   <value — how Sprinto helps>
 *
 *   <ask — one low-friction question>
 *
 *   Best,
 *   Dhivya Vijay
 *   Growth, Sprinto
 */

export const SIGN_OFF = "Best,";

export interface EmailParts {
  firstName: string;
  paragraphs: string[];
  senderName: string;
  senderTitle: string;
}

/** Collapse spaces but keep intentional line breaks inside a paragraph (e.g. a list of times). */
const clean = (s: string) => s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");

export function assembleEmail(p: EmailParts): string {
  const paras = p.paragraphs.map(clean).filter(Boolean);
  return [`Hi ${p.firstName},`, ...paras, `${SIGN_OFF}\n${p.senderName}\n${p.senderTitle}`].join("\n\n");
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Normalise free text (templates, instruction replies, older drafts) into the same layout:
 * greeting, one blank line between paragraphs, sign-off + signature. Idempotent.
 */
export function normalizeBody(raw: string, senderName: string, senderTitle: string): string {
  let b = raw.replace(/\r\n/g, "\n").trim();
  // Strip any signature / sign-off already present (we re-add it).
  for (let i = 0; i < 2; i++) {
    for (const s of [senderTitle, senderName]) b = b.replace(new RegExp(`[\\s,]*${esc(s)}\\s*$`), "").trim();
    b = b.replace(/[\s,]*(Best regards|Kind regards|Best|Thanks|Cheers|Regards)[,.]?\s*$/i, "").trim();
  }
  const g = /^Hi ([^,\n]+),\s*/.exec(b);
  const firstName = g ? g[1].trim() : "there";
  if (g) b = b.slice(g[0].length).trim();

  // Blank lines separate paragraphs; if there are none, every line is its own paragraph.
  let paras = (/\n\s*\n/.test(b) ? b.split(/\n\s*\n/) : b.split("\n")).map(clean).filter(Boolean);
  if (paras.length === 1 && !paras[0].includes("\n")) {
    // One run-on block: split into hook / pain / value / ask by sentence.
    const sentences = paras[0].match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? paras;
    const grouped: string[] = [];
    for (const s of sentences) {
      const startNew = grouped.length === 0 || grouped.length === 1 || /^(Sprinto|Would|Open|Are|Could|Can|Worth|Happy|If)\b/.test(s) || /\?$/.test(s);
      if (startNew) grouped.push(s); else grouped[grouped.length - 1] += ` ${s}`;
    }
    paras = grouped;
  }
  return assembleEmail({ firstName, paragraphs: paras, senderName, senderTitle });
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const linkify = (s: string) => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');

/**
 * Minimal HTML alternative so paragraph spacing renders reliably in every client.
 * Deliberately plain (no images, no colours): it should look like a person typed it.
 */
export function toHtml(text: string, footer?: string): string {
  const paras = text.split(/\n\s*\n/).map((p) => `<p style="margin:0 0 14px 0">${linkify(escHtml(p)).replace(/\n/g, "<br>")}</p>`).join("");
  const foot = footer
    ? `<p style="margin:22px 0 0 0;padding-top:8px;border-top:1px solid #ddd;font-size:12px;color:#888">${escHtml(footer.trim())}</p>`
    : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${paras}${foot}</div>`;
}
