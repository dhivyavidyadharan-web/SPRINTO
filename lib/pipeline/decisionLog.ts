import type { GateId, GateResult, SignalId, SignalResult } from "../rubric";
import type { FetchTrailEntry, NewsSummary } from "./qualify";
import type { PainPoint } from "./painPoints";

export interface DecisionLog {
  domain: string;
  runAt: string;
  verdict: string;
  score: number;
  flags: string[];
  gates: Partial<Record<GateId, GateResult>>;
  signals: Partial<Record<SignalId, SignalResult>>;
  verdictReason: string;
  codeRationale?: string;
  inputNeededReason?: string | null;
  stopReason?: string;
  /** First screen of the news page (for undated T6 events when Steps 4–7 resume in a later request). */
  newsFirstScreen?: string;
  fetchTrail: FetchTrailEntry[];
  /** Headlines from the news-feed check, and which ones were used as evidence. */
  news?: NewsSummary;
  httpRequests: number;
  contact?: {
    chosen: { name: string; title: string | null; email: string | null; linkedinUrl?: string | null; source: string } | null;
    ruleUsed: string;
    provider?: string;
    candidatesCount?: number;
    rejected: { name: string; title: string | null; reason: string }[];
  };
  painPoints?: PainPoint[];
  painPointsRejected?: { id: string; reason: string }[];
  email?: {
    subject: string; body: string; hookSignalId: string | null; hookQuote: string | null; rulesApplied: string[];
    painPointIdsUsed?: string[];
    qualityGate: { passed: boolean; attempts: number; failures: string[][] };
    /** Self-learning: trial rules shown to the drafter and the A/B arm this email got. */
    learning?: { trialRuleIds: string[]; experiment: { experimentId: number; arm: "A" | "B"; dimension: string; instruction: string } | null };
  };
  send?: { status: string; messageId: string | null; threadId: string | null; dryRun: boolean; error?: string };
  tokens: { in: number; out: number };
  estCostUsd: number;
  errors: string[];
  overrides?: { ts: string; action: string; note?: string }[];
}

export function emptyLog(domain: string): DecisionLog {
  return { domain, runAt: new Date().toISOString(), verdict: "PENDING", score: 0, flags: [], gates: {}, signals: {}, verdictReason: "", fetchTrail: [], httpRequests: 0, tokens: { in: 0, out: 0 }, estCostUsd: 0, errors: [] };
}
