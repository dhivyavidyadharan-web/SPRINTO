/** Plain-English wording for the dashboard: hides internal step names, IDs and raw timestamps. */

const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?/g;

export function niceDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
const dates = (s: string) => (s.match(ISO_RE) ?? []).map(niceDate);

const REPLY: Record<string, string> = {
  interested: "interested", not_interested: "not interested", counter_proposal: "suggested another time", confirmed: "accepted a time",
  unclear: "unclear", unsubscribe: "asked to stop", needs_human: "needs a person to answer",
};

/** One conversation step in plain English, or null to hide it. */
export function plainStep(h: { node: string; action: string; result: string }): string | null {
  const r = h.result ?? "";
  switch (h.node) {
    case "start": return "First email sent";
    case "waitForReply": case "updateCrm": case "checkCalendar": case "checkProposedSlot": case "handleCounter": case "setSlotFromAccepted": return null;
    case "classifyReply": {
      const k = Object.keys(REPLY).find((x) => r.startsWith(x));
      const d = dates(r)[0];
      return `They replied: ${k ? REPLY[k] : "reply read"}${d ? ` (suggested ${d})` : ""}`;
    }
    case "proposeTimes": { const d = dates(r); return d.length ? `Offered times: ${d.join(" or ")}` : "Offered meeting times"; }
    case "bookMeeting": { const d = dates(r)[0]; return `Meeting booked${d ? ` for ${d}` : ""}`; }
    case "sendConfirmation": return "Confirmation email sent";
    case "handleDecline": return "Thanked them for the reply and parked the deal";
    case "unsubscribe": return "Stopped emailing (they asked)";
    case "askClarification": return "Asked them to clarify";
    case "noReplyCheck": return /due|sent/i.test(r) ? "Checked for a reply" : null;
    case "sendFollowup": return /2/.test(h.action + r) ? "Follow-up 2 sent" : "Follow-up sent";
    case "moveToBackup": return "No reply after follow-ups. Parked for later";
    case "flagInputNeeded": return `Handed to you: ${r}`;
    case "humanAction": return `You stepped in (${h.action.replace(/_/g, " ")})`;
    case "manual": return /calendly/i.test(r) ? "Booked in Calendly" : "Manual update";
    default: return null;
  }
}

/** Conversation stage → plain words. */
export const STAGE_LABEL: Record<string, string> = {
  waiting: "Waiting for a reply", waiting_for_reply: "Waiting for a reply", negotiating: "Agreeing a time", booked: "Meeting booked",
  declined: "Declined", backup: "Parked", unsubscribed: "Unsubscribed", input_needed: "Needs your input", closed: "Closed",
};
export const stageLabel = (s: string | null | undefined) => (s ? STAGE_LABEL[s] ?? s.replace(/_/g, " ") : "");

/** Activity-feed events worth showing a person, with plain labels. Anything not listed is hidden. */
export const EVENT_LABELS: Record<string, string> = {
  enqueued: "added", qualified_verdict: "researched", contact_chosen: "decision-maker found", cold_email_sent: "first email sent",
  resume_reply: "replied", email_scheduling: "we offered meeting times", stage_booked: "meeting booked", calendly_booking: "booked in Calendly",
  email_decline_ack: "we acknowledged their decline", stage_declined: "parked (declined)", stage_backup: "parked (no reply)",
  stage_unsubscribed: "unsubscribed", email_clarify: "we asked a clarifying question", followup_1_sent: "follow-up 1 sent",
  followup_2_sent: "follow-up 2 sent", input_needed: "needs your input", feedback_distilled: "you gave feedback",
  reengage_requested: "re-engaged", unreachable: "website couldn't be read", requeued_after_revisit: "back in the queue (revisit date)",
  send_failed: "email failed to send", human_instruction_sent: "your reply was sent", marked_do_not_contact: "marked do-not-contact",
  learning_rule_promoted: "agent learned a new writing rule", learning_experiment_concluded: "an A/B test finished",
};

const VERDICT_WORD: Record<string, string> = { QUALIFIED: "qualified", DISQUALIFIED: "not a fit", NURTURE: "good fit, not ready yet", INPUT_NEEDED: "needs your input", UNREACHABLE: "website couldn't be read" };

export function eventLabel(type: string, payload: unknown): string | null {
  if (type === "qualified_verdict") {
    const v = (payload as { verdict?: string } | null)?.verdict;
    return v ? `researched: ${VERDICT_WORD[v] ?? v.toLowerCase()}` : EVENT_LABELS[type];
  }
  return EVENT_LABELS[type] ?? null;
}

/** Drop hidden events and immediate repeats of the same thing for the same company. */
export function cleanFeed<T extends { e: { type: string; companyId: number | null; payload: unknown } }>(rows: T[], limit: number) {
  const out: (T & { text: string })[] = [];
  for (const r of rows) {
    const text = eventLabel(r.e.type, r.e.payload);
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.e.companyId === r.e.companyId && prev.text === text) continue;
    out.push({ ...r, text });
    if (out.length >= limit) break;
  }
  return out;
}
