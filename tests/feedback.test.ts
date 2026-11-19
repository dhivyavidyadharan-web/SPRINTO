import { describe, it, expect, vi } from "vitest";
import { findDuplicate, rulesToRetire, similarity, summariseOutcomes, type RuleLike } from "@/lib/feedback/rules";

const r = (id: number, kind: string, text: string, timesApplied = 0, daysAgo = 0): RuleLike =>
  ({ id, kind, text, timesApplied, status: "active", createdAt: new Date(Date.now() - daysAgo * 86_400_000) });

describe("feedback → rules", () => {
  it("detects near-duplicate rules (merge instead of add)", () => {
    const active = [r(1, "do", "Name the exact job posting in the first line")];
    expect(findDuplicate({ kind: "do", text: "Name the exact job posting in the opening line" }, active)?.id).toBe(1);
    expect(findDuplicate({ kind: "dont", text: "Open with a compliment about their product" }, active)).toBeNull();
  });
  it("honours the model's duplicateOf hint", () => {
    expect(findDuplicate({ kind: "do", text: "something else" }, [r(7, "do", "x")], [7])?.id).toBe(7);
  });
  it("different kinds are never merged", () => {
    expect(findDuplicate({ kind: "dont", text: "Name the exact job posting in the first line" }, [r(1, "do", "Name the exact job posting in the first line")])).toBeNull();
  });
  it("caps active rules at 10 by retiring oldest least-applied", () => {
    const rules = Array.from({ length: 12 }, (_, i) => r(i + 1, "do", `rule ${i}`, i < 3 ? 0 : 5, 12 - i));
    const retire = rulesToRetire(rules, 10);
    expect(retire).toEqual([1, 2]);
    expect(rulesToRetire(rules.slice(0, 10), 10)).toEqual([]);
  });
  it("similarity is symmetric and bounded", () => {
    const a = "Keep subject lines under five words", b = "Subject lines under five words";
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a));
    expect(similarity(a, b)).toBeLessThanOrEqual(1);
  });
  it("summarises hook outcomes in ≤ 3 lines", () => {
    const s = summariseOutcomes([
      { hookSignalId: "T1", painPointIds: [], outcome: "booked" },
      { hookSignalId: "T1", painPointIds: [], outcome: "booked" },
      { hookSignalId: "T3", painPointIds: [], outcome: "no_reply" },
      { hookSignalId: "T3", painPointIds: [], outcome: "no_reply" },
      { hookSignalId: "T2", painPointIds: [], outcome: "positive" },
      { hookSignalId: "T6", painPointIds: [], outcome: "negative" },
    ], { T1: "Hiring", T3: "Enterprise plan" });
    const lines = s.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^T1 .*2 booked/);
  });
});

describe("drafter receives active rules", () => {
  it("injects active rules into the cold-email prompt and keeps only valid rule ids", async () => {
    vi.resetModules();
    const calls: { prompt: string }[] = [];
    vi.doMock("@/lib/llm/gemini", () => ({
      generateJson: async (o: { prompt: string }) => {
        calls.push(o);
        return { subject: "Your GRC Lead role", hook: "Saw the GRC Lead role.", pain: "", value: "", cta: "Open to a call?", hookSignalId: "T1", hookQuote: "We are hiring a GRC Lead", painPointIdsUsed: ["first_compliance_hire_overloaded"], rulesApplied: ["R3", "R99"] };
      },
    }));
    const { draftColdEmail } = await import("@/lib/pipeline/draft");
    const { computeVerdict } = await import("@/lib/rubric");
    const { facts, ctx } = await import("./helpers");
    const f = facts({ isSoftwareProduct: true, buyerType: "business", complianceSecurityRoles: ["GRC Lead"] });
    f.complianceSecurityRoles.evidence = "We are hiring a GRC Lead";
    const res = await draftColdEmail({
      domain: "acme.com", companyName: "Acme", facts: f, verdict: computeVerdict(f, ctx()),
      contact: { firstName: "Priya", lastName: "Rao", title: "CTO" }, painPoints: [],
      rules: [{ id: 3, kind: "dont", text: "Open with a compliment about their product" }], hookSummary: "No reply outcomes yet.",
    });
    expect(calls[0].prompt).toContain("R3 [DONT]: Open with a compliment about their product");
    expect(res.rulesApplied).toEqual(["R3"]);
    vi.doUnmock("@/lib/llm/gemini");
  });
});
