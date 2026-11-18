import { BANNED_PHRASES, EMAIL_LIMITS, EMOJI_RE, PLACEHOLDER_RE, SPRINTO_FACTS, ALLOWED_TERMS, type SignalId } from "../rubric";
import { normalizeText, quoteIn } from "../facts";

export interface GateInput {
  subject: string;
  body: string;
  firstName: string;
  hookSignalId?: string | null;
  hookQuote?: string | null;
  firedSignals: SignalId[];
  evidence: string[];
  /** Text the email may legitimately draw names/numbers from (facts, evidence, contact, sender). */
  allowedSource: string;
  maxWords?: number;
  requireHook?: boolean;
}

export interface GateResult { passed: boolean; failures: string[] }

export function wordCount(s: string) {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Body without signature / live-test footer, for word counting. */
function coreBody(body: string) {
  return body.split(/\n—\s*Live test/)[0];
}

export function qualityGate(i: GateInput): GateResult {
  const failures: string[] = [];
  const body = i.body.trim();
  const firstLine = body.split("\n")[0] ?? "";
  const maxWords = i.maxWords ?? EMAIL_LIMITS.COLD_MAX_WORDS;

  if (!i.firstName || !new RegExp(`^Hi ${escapeRe(i.firstName)},`).test(firstLine.trim())) failures.push(`greeting must be "Hi ${i.firstName},"`);
  if (i.requireHook !== false) {
    if (!i.hookSignalId || !i.firedSignals.includes(i.hookSignalId as SignalId)) failures.push(`hookSignalId "${i.hookSignalId}" is not a fired signal (${i.firedSignals.join(", ")})`);
    if (!i.hookQuote || !i.evidence.some((e) => quoteIn(i.hookQuote, e) || quoteIn(e, i.hookQuote ?? ""))) failures.push("hookQuote does not appear in stored evidence");
  }
  const wc = wordCount(coreBody(body));
  if (wc > maxWords) failures.push(`body is ${wc} words (max ${maxWords})`);
  const sw = wordCount(i.subject);
  if (sw > EMAIL_LIMITS.SUBJECT_MAX_WORDS) failures.push(`subject is ${sw} words (max ${EMAIL_LIMITS.SUBJECT_MAX_WORDS})`);
  if (/!/.test(i.subject)) failures.push('subject contains "!"');
  if (/\b[A-Z]{5,}\b/.test(i.subject.replace(/\b(GDPR|HIPAA|SOC|ISO|GRC|SAML|CISO)\b/g, ""))) failures.push("subject contains ALL CAPS words");
  if (PLACEHOLDER_RE.test(body) || PLACEHOLDER_RE.test(i.subject)) failures.push("contains placeholder ([ ], {{ }}, TBD or Lorem)");
  const low = `${i.subject}\n${body}`.toLowerCase();
  for (const p of BANNED_PHRASES) if (low.includes(p)) failures.push(`banned phrase: "${p}"`);
  if (EMOJI_RE.test(body) || EMOJI_RE.test(i.subject)) failures.push("contains emoji");

  const allowed = normalizeText(`${i.allowedSource}\n${SPRINTO_FACTS.join("\n")}\n${ALLOWED_TERMS.join(" ")}`);
  // Numbers / percentages must come from facts (e.g. "Series B", "SOC 2", "27001", "20-minute" CTA allowed).
  const numbers = coreBody(body).match(/\$?\d[\d,.]*%?[kKmMbB]?/g) ?? [];
  for (const n of numbers) {
    const norm = normalizeText(n);
    if (["2", "27001", "20", "30", "1", "15"].includes(norm)) continue; // SOC 2, ISO 27001, CTA durations
    if (!allowed.includes(norm)) failures.push(`number "${n}" not found in facts`);
  }
  // Capitalised multi-word names / brand-like tokens not in facts (crude invented-company check).
  const sentences = coreBody(body).split(/\n/).slice(1).join(" ");
  const caps = sentences.match(/(?<![.!?]\s)(?<!^)\b[A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)*/g) ?? [];
  const COMMON = new Set(["I", "We", "Our", "Your", "You", "The", "A", "An", "If", "Would", "Happy", "Best", "Thanks", "Cheers", "Regards", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Type", "II", "Enterprise", "Security", "Trust", "Head", "Director", "VP", "Lead", "Engineering", "Compliance", "When", "With", "That", "This", "Since", "Most", "Teams", "As", "It", "Is", "Are", "Could", "Do", "Does", "How", "Worth", "Open", "Quick", "Saw", "Noticed", "Given", "Once", "Many", "One", "No", "Not", "Or", "And", "But", "So", "Hi", "Live", "Plan"]);
  for (const c of caps) {
    const words = c.split(/\s+/).filter((w) => !COMMON.has(w));
    for (const w of words) {
      const nw = normalizeText(w);
      if (!nw || nw.length < 3) continue;
      if (!allowed.includes(nw)) { failures.push(`name/term "${w}" not found in facts`); break; }
    }
  }
  return { passed: failures.length === 0, failures: dedupe(failures) };
}

function dedupe(a: string[]) { return [...new Set(a)]; }
function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
