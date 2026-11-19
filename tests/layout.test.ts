import { describe, it, expect } from "vitest";
import { assembleEmail, normalizeBody, toHtml } from "@/lib/mail/layout";

const NAME = "Test Sender", TITLE = "Growth, Sprinto";

describe("email layout", () => {
  it("assembles greeting, one paragraph per part, sign-off and signature with blank lines", () => {
    const out = assembleEmail({ firstName: "Macgill", paragraphs: ["Hook.", "Pain sentence.", "", "Open to a call?"], senderName: NAME, senderTitle: TITLE });
    expect(out).toBe("Hi Macgill,\n\nHook.\n\nPain sentence.\n\nOpen to a call?\n\nBest,\nTest Sender\nGrowth, Sprinto");
  });

  it("splits a one-line run-on draft (regression: Idukki cold email)", () => {
    const raw = "Hi Sahil, I noticed on Idukki's trust page that your SOC 2 is in audit. That can stall big deals in security reviews. Sprinto automates evidence collection. Open to a 20-minute call next week? Test Sender Growth, Sprinto";
    expect(normalizeBody(raw, NAME, TITLE)).toBe(
      "Hi Sahil,\n\nI noticed on Idukki's trust page that your SOC 2 is in audit.\n\nThat can stall big deals in security reviews.\n\nSprinto automates evidence collection.\n\nOpen to a 20-minute call next week?\n\nBest,\nTest Sender\nGrowth, Sprinto",
    );
  });

  it("turns single line breaks into paragraphs (regression: Rize cold email)", () => {
    const raw = "Hi Macgill,\nI saw your SOC 2 engagement.\nThat pulls engineers off the roadmap.\nWould you be open to a call?\nTest Sender\nGrowth, Sprinto";
    expect(normalizeBody(raw, NAME, TITLE)).toBe("Hi Macgill,\n\nI saw your SOC 2 engagement.\n\nThat pulls engineers off the roadmap.\n\nWould you be open to a call?\n\nBest,\nTest Sender\nGrowth, Sprinto");
  });

  it("keeps a bulleted list of times together and is idempotent", () => {
    const raw = "Hi Macgill,\n\nGreat to hear from you.\n\nWould either of these work?\n• Mon 10:00\n• Tue 15:00\n\nTest Sender";
    const once = normalizeBody(raw, NAME, TITLE);
    expect(once).toContain("Would either of these work?\n• Mon 10:00\n• Tue 15:00");
    expect(normalizeBody(once, NAME, TITLE)).toBe(once);
    expect(once.match(/Best,/g)).toHaveLength(1);
  });

  it("HTML version has one <p> per paragraph and a separated footer", () => {
    const html = toHtml("Hi A,\n\nLine one.\n\nBest,\nName", "Live test. Intended recipient: X");
    expect(html.match(/<p /g)).toHaveLength(4);
    expect(html).toContain("Best,<br>Name");
    expect(html).toContain("border-top");
  });
});
