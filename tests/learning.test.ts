import { describe, it, expect, afterEach } from "vitest";
import {
  findPatterns, trialDecision, rollbackCheck, experimentDecision, pointSuggestions, assignArm, zScore, rate, patternText, LEARN, type Sample,
} from "@/lib/learning/stats";
import { decideVerdict, setPointOverrides, signalPoints, SIGNALS } from "@/lib/rubric";

let nextId = 1;
function mk(over: Partial<Sample>, success: boolean): Sample {
  return { emailId: nextId++, success, hook: "T1", pain: "audit_prep_eats_engineering_time", length: "short", role: "CTO", stage: "early", firedSignals: ["T1"], trialRuleIds: [], variant: null, ...over };
}
function many(n: number, wins: number, over: Partial<Sample>): Sample[] {
  return Array.from({ length: n }, (_, i) => mk(over, i < wins));
}

afterEach(() => setPointOverrides({}));

describe("stats helpers", () => {
  it("z-score is positive when a beats b, zero with no data", () => {
    expect(zScore(rate(many(20, 10, {})), rate(many(20, 2, {})))).toBeGreaterThan(LEARN.Z);
    expect(zScore(rate([]), rate(many(5, 1, {})))).toBe(0);
  });
  it("assigns arms deterministically and roughly 50/50", () => {
    expect(assignArm(42)).toBe(assignArm(42));
    const a = Array.from({ length: 1000 }, (_, i) => assignArm(i)).filter((x) => x === "A").length;
    expect(a).toBeGreaterThan(400);
    expect(a).toBeLessThan(600);
  });
});

describe("A: pattern finding", () => {
  it("ignores small samples (no rule from 2 lucky replies)", () => {
    const s = [...many(3, 2, { hook: "T2" }), ...many(3, 0, { hook: "T1" })];
    expect(findPatterns(s)).toEqual([]);
  });

  it("finds a segment-specific 'prefer' pattern with enough evidence", () => {
    const s = [
      ...many(12, 7, { stage: "growth", role: "CTO", pain: "audit_prep_eats_engineering_time" }),
      ...many(12, 1, { stage: "growth", role: "CTO", pain: "deals_blocked_by_security_reviews" }),
    ];
    const p = findPatterns(s).find((x) => x.lever === "pain" && x.direction === "prefer");
    expect(p).toBeTruthy();
    expect(p!.leverValue).toBe("audit_prep_eats_engineering_time");
    expect(p!.kind).toBe("do");
    expect(p!.text).toMatch(/pain point/);
  });

  it("finds an 'avoid' pattern", () => {
    const s = [...many(12, 0, { hook: "T5" }), ...many(12, 8, { hook: "T1" })];
    const p = findPatterns(s).find((x) => x.leverValue === "T5");
    expect(p?.direction).toBe("avoid");
    expect(p?.kind).toBe("dont");
  });

  it("writes readable rule text", () => {
    expect(patternText({ direction: "prefer", segment: "stage", segmentValue: "growth", lever: "hook", leverValue: "T1" }))
      .toBe(`For growth-stage (Series B+) companies, use the "${SIGNALS.T1.name}" observation (T1) as the opening hook when it is available.`);
  });
});

describe("A: trials and rollback", () => {
  const sent = (s: Sample[], d: Date) => new Map(s.map((x) => [x.emailId, d] as [number, Date]));
  const t0 = new Date("2026-01-01");

  it("waits until both arms have enough outcomes", () => {
    const s = [...many(3, 2, { trialRuleIds: ["R9"] }), ...many(3, 1, {})];
    expect(trialDecision(s, "R9", t0, sent(s, new Date("2026-02-01"))).decision).toBe("continue");
  });
  it("promotes a rule that does at least as well, retires one that does worse", () => {
    const good = [...many(8, 4, { trialRuleIds: ["R9"] }), ...many(8, 2, {})];
    expect(trialDecision(good, "R9", t0, sent(good, new Date("2026-02-01"))).decision).toBe("promote");
    const bad = [...many(8, 1, { trialRuleIds: ["R9"] }), ...many(8, 4, {})];
    expect(trialDecision(bad, "R9", t0, sent(bad, new Date("2026-02-01"))).decision).toBe("retire");
  });
  it("ignores emails sent before the trial started", () => {
    const old = many(10, 0, {});
    const fresh = [...many(6, 3, { trialRuleIds: ["R9"] }), ...many(6, 3, {})];
    const m = new Map([...sent(old, new Date("2025-06-01")), ...sent(fresh, new Date("2026-02-01"))]);
    const v = trialDecision([...old, ...fresh], "R9", t0, m);
    expect(v.without.n).toBe(6);
  });
  it("rolls back a promoted rule only when results clearly drop", () => {
    const before = many(12, 8, {}); const after = many(14, 1, {});
    const m = new Map([...sent(before, new Date("2025-12-01")), ...sent(after, new Date("2026-02-01"))]);
    expect(rollbackCheck([...before, ...after], t0, m).rollback).toBe(true);
    const after2 = many(14, 7, {});
    const m2 = new Map([...sent(before, new Date("2025-12-01")), ...sent(after2, new Date("2026-02-01"))]);
    expect(rollbackCheck([...before, ...after2], t0, m2).rollback).toBe(false);
  });
});

describe("B: experiments", () => {
  it("keeps collecting below the minimum", () => {
    const s = [...many(5, 3, { variant: { experimentId: 1, arm: "A" } }), ...many(5, 0, { variant: { experimentId: 1, arm: "B" } })];
    expect(experimentDecision(s, 1).decision).toBe("continue");
  });
  it("declares a winner with a clear difference", () => {
    const s = [...many(20, 2, { variant: { experimentId: 1, arm: "A" } }), ...many(20, 10, { variant: { experimentId: 1, arm: "B" } })];
    const v = experimentDecision(s, 1);
    expect(v.decision).toBe("winner");
    expect(v.winner).toBe("B");
  });
  it("concludes with no winner after the max when results are equal", () => {
    const s = [...many(40, 8, { variant: { experimentId: 2, arm: "A" } }), ...many(40, 8, { variant: { experimentId: 2, arm: "B" } })];
    expect(experimentDecision(s, 2).decision).toBe("no_winner");
  });
  it("only counts its own experiment", () => {
    const s = many(30, 10, { variant: { experimentId: 9, arm: "A" } });
    expect(experimentDecision(s, 1).a.n).toBe(0);
  });
});

describe("C: rubric point suggestions + overrides", () => {
  it("suggests lowering a signal that predicts silence", () => {
    const s = [...many(10, 0, { firedSignals: ["T5"] }), ...many(10, 6, { firedSignals: ["T1"] })];
    const sug = pointSuggestions(s).find((x) => x.signal === "T5");
    expect(sug).toMatchObject({ current: SIGNALS.T5.points, proposed: Math.max(0, SIGNALS.T5.points - 1) });
  });
  it("approved overrides change scoring, bounded 0..4", () => {
    const g = { G1: "pass", G2: "pass", G3: "pass", G4: "pass", G5: "pass" } as const;
    expect(decideVerdict({ ...g }, ["T1", "F1"]).score).toBe(SIGNALS.T1.points + SIGNALS.F1.points);
    setPointOverrides({ T1: 1, F1: 99 });
    expect(signalPoints("F1")).toBe(4);
    expect(decideVerdict({ ...g }, ["T1", "F1"]).score).toBe(5);
    setPointOverrides({});
    expect(signalPoints("T1")).toBe(SIGNALS.T1.points);
  });
});
