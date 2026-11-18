import { describe, it, expect } from "vitest";
import { rankContacts, type CandidateContact } from "@/lib/rubric";
import { facts } from "./helpers";

const c = (firstName: string, title: string, email = `${firstName.toLowerCase()}@acme.com`, extra: Partial<CandidateContact> = {}): CandidateContact =>
  ({ firstName, lastName: "X", title, email, source: "apollo_manual", ...extra });

const pool = [
  c("Sam", "VP Sales"),
  c("Mia", "Head of Marketing"),
  c("Hal", "HR Manager"),
  c("Pat", "Product Manager"),
  c("Ceo", "Co-founder & CEO"),
  c("Tia", "CTO"),
  c("Eve", "VP Engineering"),
  c("Sec", "Head of Security & Compliance"),
  c("Ops", "COO"),
  c("Info", "Founder", "info@acme.com"),
];

describe("contact ranking", () => {
  it("Seed / Series A → CTO first", () => {
    const r = rankContacts(pool, facts({ fundingStage: "Series A" }));
    expect(r.chosen?.title).toBe("CTO");
  });
  it("headcount <= 50 → early-stage list even without stage", () => {
    expect(rankContacts(pool, facts({ headcountEstimate: 30 })).chosen?.title).toBe("CTO");
  });
  it("Series B → security/compliance head first", () => {
    const r = rankContacts(pool, facts({ fundingStage: "Series B" }));
    expect(r.chosen?.title).toBe("Head of Security & Compliance");
    expect(r.ruleUsed).toMatch(/growth-stage/);
  });
  it("Series C without security head → VP Engineering", () => {
    const r = rankContacts(pool.filter((p) => p.firstName !== "Sec"), facts({ fundingStage: "Series C" }));
    expect(r.chosen?.title).toBe("VP Engineering");
  });
  it("early stage without CTO → founder/CEO", () => {
    const r = rankContacts(pool.filter((p) => p.title !== "CTO"), facts({ fundingStage: "Seed" }));
    expect(r.chosen?.title).toBe("Co-founder & CEO");
  });
  it("sales, marketing, HR, generic inboxes and plain managers are never chosen", () => {
    const bad = [c("Sam", "VP Sales"), c("Mia", "Head of Marketing"), c("Hal", "HR Manager"), c("Pat", "Product Manager"), c("Info", "Founder", "info@acme.com"), c("Sup", "Support Lead"), c("Int", "Engineering Intern")];
    const r = rankContacts(bad, facts({ fundingStage: "Series B" }));
    expect(r.chosen).toBeNull();
    expect(r.rejected).toHaveLength(bad.length);
    expect(r.rejected.find((x) => x.name.startsWith("Info"))?.reason).toMatch(/generic inbox/);
    expect(r.rejected.find((x) => x.title === "Product Manager")?.reason).toMatch(/manager/);
  });
  it("Hunter contacts below 70 confidence are ignored", () => {
    const r = rankContacts([c("Tia", "CTO", "tia@acme.com", { source: "hunter", confidence: 50 })], facts({ fundingStage: "Seed" }));
    expect(r.chosen).toBeNull();
    expect(r.rejected[0].reason).toMatch(/confidence/);
  });
  it("none eligible → chosen null (pipeline maps to INPUT_NEEDED)", () => {
    expect(rankContacts([], facts({})).chosen).toBeNull();
  });
  it("logs why eligible runners-up lost", () => {
    const r = rankContacts(pool, facts({ fundingStage: "Series B" }));
    expect(r.rejected.some((x) => /ranked below/.test(x.reason))).toBe(true);
  });
});
