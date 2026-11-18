import { describe, it, expect } from "vitest";
import { computeVerdict, FLAGS } from "@/lib/rubric";
import { facts, ctx, b2bSaas } from "./helpers";

describe("rubric verdicts", () => {
  it("SOC 2 achieved → DISQUALIFIED (G3)", () => {
    const v = computeVerdict(facts({ ...b2bSaas, certificationsAchieved: ["SOC 2 Type II"], complianceSecurityRoles: ["GRC Lead"] }), ctx());
    expect(v.verdict).toBe("DISQUALIFIED");
    expect(v.gates.G3.status).toBe("fail");
  });
  it("ISO 27001 achieved → DISQUALIFIED (G3)", () => {
    expect(computeVerdict(facts({ ...b2bSaas, certificationsAchieved: ["ISO/IEC 27001:2022"] }), ctx()).gates.G3.status).toBe("fail");
  });
  it("consumer app → DISQUALIFIED (G2)", () => {
    const v = computeVerdict(facts({ isSoftwareProduct: true, buyerType: "consumer", hasEnterprisePlan: true }), ctx());
    expect(v.verdict).toBe("DISQUALIFIED");
    expect(v.gates.G2.status).toBe("fail");
  });
  it("agency (not software) → DISQUALIFIED (G1)", () => {
    expect(computeVerdict(facts({ isSoftwareProduct: false, buyerType: "business" }), ctx()).gates.G1.status).toBe("fail");
  });
  it("Vanta trust page → DISQUALIFIED (G4)", () => {
    const v = computeVerdict(facts({ ...b2bSaas, complianceToolDetected: "Vanta", hasEnterprisePlan: true }), ctx());
    expect(v.verdict).toBe("DISQUALIFIED");
    expect(v.gates.G4.status).toBe("fail");
  });
  it("public company → DISQUALIFIED (G5)", () => {
    const v = computeVerdict(facts({ ...b2bSaas, fundingStage: "Public", hasEnterprisePlan: true }), ctx());
    expect(v.verdict).toBe("DISQUALIFIED");
    expect(v.gates.G5.status).toBe("fail");
  });
  it("headcount >= 1000 → DISQUALIFIED (G5)", () => {
    expect(computeVerdict(facts({ ...b2bSaas, headcountEstimate: 1500 }), ctx()).gates.G5.status).toBe("fail");
  });
  it("B2B SaaS Series B hiring a GRC lead with enterprise plan → QUALIFIED, no flags", () => {
    const v = computeVerdict(facts({ ...b2bSaas, fundingStage: "Series B", complianceSecurityRoles: ["GRC Lead"], hasEnterprisePlan: true, headcountEstimate: 120 }), ctx());
    expect(v.verdict).toBe("QUALIFIED");
    expect(v.flags).toEqual([]);
    expect(v.firedSignals).toEqual(expect.arrayContaining(["T1", "T3", "F1", "F2"]));
    expect(v.score).toBe(3 + 2 + 2 + 1);
  });
  it("B2B SaaS with no timing signal → NURTURE", () => {
    expect(computeVerdict(facts({ ...b2bSaas, fundingStage: "Series A", headcountEstimate: 40 }), ctx()).verdict).toBe("NURTURE");
  });
  it("product type unknown → INPUT_NEEDED", () => {
    const v = computeVerdict(facts({ buyerType: "business", hasEnterprisePlan: true }), ctx());
    expect(v.verdict).toBe("INPUT_NEEDED");
    expect(v.inputNeededReason).toBe("cannot_determine_product");
  });
  it("buyer type unknown → INPUT_NEEDED", () => {
    expect(computeVerdict(facts({ isSoftwareProduct: true, hasEnterprisePlan: true }), ctx()).inputNeededReason).toBe("cannot_determine_buyer");
  });
  it("timing signal but stage unknown → QUALIFIED with stage flag", () => {
    const v = computeVerdict(facts({ ...b2bSaas, complianceSecurityRoles: ["Security Engineer"], certificationsInProgress: ["SOC 2"] }), ctx());
    expect(v.verdict).toBe("QUALIFIED");
    expect(v.flags).toContain(FLAGS.STAGE_UNVERIFIED);
  });
  it("security page not visited → cert_status_unverified flag", () => {
    const v = computeVerdict(facts({ ...b2bSaas, fundingStage: "Series A", complianceSecurityRoles: ["GRC Lead"], hasEnterprisePlan: true }), ctx(["homepage", "careers"]));
    expect(v.flags).toContain(FLAGS.CERT_UNVERIFIED);
  });
  it("one weak timing signal → QUALIFIED with low-score flag", () => {
    const v = computeVerdict(facts({ ...b2bSaas, fundingStage: "Seed", mentionsGdprOrDpa: true }), ctx());
    expect(v.verdict).toBe("QUALIFIED");
    expect(v.flags).toContain(FLAGS.LOW_SCORE);
  });
  it("SOC 2 in progress → T2 fires, not G3", () => {
    const v = computeVerdict(facts({ ...b2bSaas, fundingStage: "Series A", certificationsInProgress: ["SOC 2 Type II"] }), ctx());
    expect(v.gates.G3.status).toBe("pass");
    expect(v.signals.T2.fired).toBe(true);
    expect(v.verdict).toBe("QUALIFIED");
  });
  it("T5 does not fire when a cert is achieved", () => {
    expect(computeVerdict(facts({ ...b2bSaas, mentionsGdprOrDpa: true, certificationsAchieved: ["HIPAA"] }), ctx()).signals.T5.fired).toBe(false);
  });
  it("funding news 3 months old → T6 fires; 2 years old → does not", () => {
    const ev = (date: string) => [{ type: "funding", headline: "Raised Series A", date, evidence: "we raised our Series A", sourceUrl: "https://x.com/news" }];
    expect(computeVerdict(facts({ ...b2bSaas, recentEvents: ev("2026-08-15") }), ctx()).signals.T6.fired).toBe(true);
    expect(computeVerdict(facts({ ...b2bSaas, recentEvents: ev("2024-11-01") }), ctx()).signals.T6.fired).toBe(false);
  });
  it("undated event counts only if on the news page's first screen", () => {
    const evs = [{ type: "enterprise_launch", headline: "Enterprise plan launch", date: null, evidence: "Introducing our Enterprise plan", sourceUrl: "https://x.com/blog" }];
    expect(computeVerdict(facts({ ...b2bSaas, recentEvents: evs }), ctx(undefined, { newsFirstScreen: "Blog\nIntroducing our Enterprise plan with SSO" })).signals.T6.fired).toBe(true);
    expect(computeVerdict(facts({ ...b2bSaas, recentEvents: evs }), ctx(undefined, { newsFirstScreen: "Other posts only" })).signals.T6.fired).toBe(false);
  });
  it("security_incident events never fire T6", () => {
    const evs = [{ type: "security_incident", headline: "Breach", date: "2026-10-01", evidence: "we had an incident", sourceUrl: "u" }];
    expect(computeVerdict(facts({ ...b2bSaas, recentEvents: evs }), ctx()).signals.T6.fired).toBe(false);
  });
});
