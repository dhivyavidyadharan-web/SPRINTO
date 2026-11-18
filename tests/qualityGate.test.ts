import { describe, it, expect } from "vitest";
import { qualityGate, type GateInput } from "@/lib/pipeline/qualityGate";

const evidence = ["We're hiring a Senior GRC Analyst to own our SOC 2 program", "Enterprise plan includes SSO/SAML and audit logs"];
const good = `Hi Priya,

Saw you're hiring a Senior GRC Analyst to own your SOC 2 program at Acme.
A first compliance hire usually ends up chasing screenshots and evidence by hand, which slows the audit.
Sprinto automates evidence collection and continuous control monitoring so teams get audit-ready faster.
Open to a 20-minute call next week?

Test Sender
Growth, Sprinto`;

const base: GateInput = {
  subject: "Your Senior GRC Analyst role",
  body: good,
  firstName: "Priya",
  hookSignalId: "T1",
  hookQuote: "hiring a Senior GRC Analyst to own our SOC 2 program",
  firedSignals: ["T1", "T3"],
  evidence,
  allowedSource: `Acme ${evidence.join(" ")} Priya Test Sender Growth, Sprinto`,
};

describe("email quality gate", () => {
  it("passes a good email", () => {
    const r = qualityGate(base);
    expect(r.failures).toEqual([]);
    expect(r.passed).toBe(true);
  });
  it("catches a missing first name", () => {
    expect(qualityGate({ ...base, body: good.replace("Hi Priya,", "Hi there,") }).failures.join()).toMatch(/greeting/);
  });
  it("catches a hook not in evidence", () => {
    expect(qualityGate({ ...base, hookQuote: "raised a $50M Series C" }).failures.join()).toMatch(/hookQuote/);
  });
  it("catches a hook signal that did not fire", () => {
    expect(qualityGate({ ...base, hookSignalId: "T6" }).failures.join()).toMatch(/not a fired signal/);
  });
  it("catches > 120 words", () => {
    const long = good.replace("Open to", `${"word ".repeat(100)}Open to`);
    expect(qualityGate({ ...base, body: long }).failures.join()).toMatch(/words/);
  });
  it("catches placeholders", () => {
    expect(qualityGate({ ...base, body: good.replace("Acme", "{{company}}") }).passed).toBe(false);
    expect(qualityGate({ ...base, body: good.replace("Acme", "[Company]") }).passed).toBe(false);
    expect(qualityGate({ ...base, body: good + "\nTBD" }).passed).toBe(false);
  });
  it("catches banned phrases", () => {
    expect(qualityGate({ ...base, body: good.replace("Saw you're", "I hope this finds you well. I came across that you're") }).failures.join()).toMatch(/banned phrase/);
  });
  it("catches invented numbers and percentages", () => {
    expect(qualityGate({ ...base, body: good.replace("which slows the audit.", "which slows the audit by 40%.") }).failures.join()).toMatch(/number/);
  });
  it("catches invented company names", () => {
    expect(qualityGate({ ...base, body: good.replace("Sprinto automates", "Like Stripe and Notion, Sprinto automates") }).failures.join()).toMatch(/Stripe|Notion/);
  });
  it("catches subject problems", () => {
    expect(qualityGate({ ...base, subject: "Quick question!" }).passed).toBe(false);
    expect(qualityGate({ ...base, subject: "one two three four five six seven eight" }).passed).toBe(false);
  });
});
