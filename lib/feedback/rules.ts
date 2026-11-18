/** Pure rule-management logic (unit-tested). */
import { normalizeText } from "../facts";

export interface RuleLike { id: number; kind: string; text: string; timesApplied: number; status: string; createdAt: Date }
export interface NewRule { kind: "do" | "dont"; text: string }

function tokens(s: string) {
  const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "with", "their", "your", "it", "is", "be", "do", "dont", "don", "t", "not", "never", "always", "email", "emails"]);
  return new Set(normalizeText(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
}

/** Jaccard similarity of content words. */
export function similarity(a: string, b: string) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export const DUPLICATE_THRESHOLD = 0.5;

/** Find an active rule this candidate duplicates (same kind, similar text). */
export function findDuplicate(candidate: NewRule, active: RuleLike[], dupIds: number[] = []): RuleLike | null {
  let best: RuleLike | null = null; let bestSim = 0;
  for (const r of active) {
    if (r.status !== "active") continue;
    if (dupIds.includes(r.id)) return r;
    if (r.kind !== candidate.kind) continue;
    const s = similarity(candidate.text, r.text);
    if (s > bestSim) { bestSim = s; best = r; }
  }
  return bestSim >= DUPLICATE_THRESHOLD ? best : null;
}

/** Which active rules to retire to get back to the cap: oldest, least-applied first. */
export function rulesToRetire(active: RuleLike[], max: number): number[] {
  const live = active.filter((r) => r.status === "active");
  if (live.length <= max) return [];
  const sorted = [...live].sort((a, b) => a.timesApplied - b.timesApplied || a.createdAt.getTime() - b.createdAt.getTime());
  return sorted.slice(0, live.length - max).map((r) => r.id);
}

export interface OutcomeRow { hookSignalId: string | null; painPointIds: string[]; outcome: string }

/** 3-line hook-performance summary for the drafter. */
export function summariseOutcomes(rows: OutcomeRow[], names: Record<string, string>): string {
  if (!rows.length) return "No reply outcomes yet.";
  const by = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const k = r.hookSignalId ?? "unknown";
    const m = by.get(k) ?? { booked: 0, positive: 0, negative: 0, no_reply: 0 };
    m[r.outcome] = (m[r.outcome] ?? 0) + 1;
    by.set(k, m);
  }
  const score = (m: Record<string, number>) => m.booked * 3 + m.positive * 2 - m.negative - m.no_reply * 0.5;
  return [...by.entries()]
    .sort((a, b) => score(b[1]) - score(a[1]))
    .slice(0, 3)
    .map(([k, m]) => `${k} ${names[k] ?? ""} hooks: ${m.booked} booked, ${m.positive} positive, ${m.negative} negative, ${m.no_reply} no reply`)
    .join("\n");
}
