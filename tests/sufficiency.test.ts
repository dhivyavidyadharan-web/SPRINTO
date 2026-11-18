import { describe, it, expect } from "vitest";
import { sufficiencyCheck, chooseNextPage, type PageType } from "@/lib/rubric";
import { emptyFacts } from "@/lib/facts";
import { runQualificationLoop } from "@/lib/pipeline/qualify";
import { facts, b2bSaas, emptyExtraction } from "./helpers";

const all = new Set<PageType>(["careers", "security", "news", "pricing", "customers", "about"]);
const okPage = (url: string, text = "some text here about nothing in particular at all") =>
  ({ url, finalUrl: url, method: "fetch" as const, status: "ok" as const, cleaned: { mainText: text, footerText: "", badgeHints: [], links: [], title: "", wordCount: 9 } });

describe("sufficiencyCheck + chooseNextPage", () => {
  it("empty facts after homepage → everything missing → careers first", () => {
    const visited = new Set<PageType>(["homepage"]);
    const missing = sufficiencyCheck(emptyFacts(), visited, all);
    expect(missing).toEqual(["product", "buyer", "certs", "timing", "fit"]);
    expect(chooseNextPage(missing, visited, all)?.page).toBe("careers");
  });
  it("only certs missing → security", () => {
    const f = facts({ ...b2bSaas, complianceSecurityRoles: ["GRC Lead"], fundingStage: "Series B" });
    const visited = new Set<PageType>(["homepage", "careers"]);
    const missing = sufficiencyCheck(f, visited, all);
    expect(missing).toEqual(["certs"]);
    expect(chooseNextPage(missing, visited, all)?.page).toBe("security");
  });
  it("only product/buyer missing → pricing (careers/security can't fill it)", () => {
    const f = facts({ complianceSecurityRoles: ["GRC"], fundingStage: "Series A" });
    const visited = new Set<PageType>(["homepage", "security"]);
    const missing = sufficiencyCheck(f, visited, all);
    expect(missing).toEqual(["product", "buyer"]);
    expect(chooseNextPage(missing, visited, all)?.page).toBe("pricing");
  });
  it("timing missing after careers+security → news", () => {
    const f = facts({ ...b2bSaas, fundingStage: "Series A" });
    const visited = new Set<PageType>(["homepage", "careers", "security"]);
    expect(chooseNextPage(sufficiencyCheck(f, visited, all), visited, all)?.page).toBe("news");
  });
  it("all satisfied → nothing missing", () => {
    const f = facts({ ...b2bSaas, complianceSecurityRoles: ["GRC"], fundingStage: "Series A" });
    expect(sufficiencyCheck(f, new Set<PageType>(["homepage", "security"]), all)).toEqual([]);
  });
  it("timing counts as decided when all T-source pages are visited", () => {
    const f = facts({ ...b2bSaas, fundingStage: "Series A" });
    const visited = new Set<PageType>(["homepage", "careers", "security", "news", "pricing", "customers"]);
    expect(sufficiencyCheck(f, visited, all)).toEqual([]);
  });
});

describe("qualification loop", () => {
  it("stops after 4 extra fetches and decides with what is known", async () => {
    const fetched: string[] = [];
    const res = await runQualificationLoop("example.com", {
      maxExtraFetches: 4,
      now: new Date("2026-11-18"),
      fetchPage: async (url, type) => { fetched.push(type); return okPage(url); },
      extract: async () => emptyExtraction(),
    });
    expect(fetched[0]).toBe("homepage");
    expect(fetched.length).toBe(1 + 4);
    expect(fetched.slice(1)).toEqual(["careers", "security", "news", "pricing"]);
    expect(res.stopReason).toMatch(/fetch cap/);
    expect(res.verdict?.verdict).toBe("INPUT_NEEDED");
    expect(res.trail).toHaveLength(5);
  });
  it("short-circuits when a gate fails on the homepage", async () => {
    const fetched: string[] = [];
    const res = await runQualificationLoop("x.com", {
      maxExtraFetches: 4,
      fetchPage: async (url, type) => { fetched.push(type); return okPage(url, "We are a design agency"); },
      extract: async () => ({ ...emptyExtraction(), isSoftwareProduct: { value: false, evidence: "We are a design agency", sourceUrl: "u" } }),
    });
    expect(fetched).toEqual(["homepage"]);
    expect(res.verdict?.verdict).toBe("DISQUALIFIED");
  });
  it("bot wall on homepage → unreachable, never bypassed", async () => {
    const res = await runQualificationLoop("x.com", {
      maxExtraFetches: 4,
      fetchPage: async (url) => ({ url, finalUrl: url, method: "fetch", status: "bot_challenge", cleaned: null }),
      extract: async () => { throw new Error("should not extract"); },
    });
    expect(res.outcome).toBe("unreachable");
  });
});

describe("certs requirement (regression)", () => {
  it("a non-disqualifying cert from the homepage still sends the loop to the security page", () => {
    const f = facts({ ...b2bSaas, certificationsAchieved: ["GDPR compliant"], enterpriseOrRegulatedCustomers: ["Leroy Merlin"], headcountEstimate: 40 });
    const visited = new Set<PageType>(["homepage", "careers"]);
    expect(sufficiencyCheck(f, visited, all)).toContain("certs");
    expect(chooseNextPage(sufficiencyCheck(f, visited, all), visited, all)?.page).toBe("security");
  });
});
