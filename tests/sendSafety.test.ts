import { describe, it, expect, vi } from "vitest";
import { assertRecipient, sendEmail, __setSmtpSend, RecipientNotAllowedError, stripQuoted, type OutgoingMail } from "@/lib/mail";

describe("send safety (live test mode)", () => {
  it("allows only MY_EMAIL", () => {
    expect(assertRecipient(undefined)).toBe("me@example.com");
    expect(assertRecipient("ME@example.com")).toBe("me@example.com");
    expect(() => assertRecipient("prospect@acme.com")).toThrow(RecipientNotAllowedError);
  });

  it("sendEmail throws for any other recipient and never touches SMTP", async () => {
    const send = vi.fn();
    __setSmtpSend(send);
    await expect(sendEmail({ to: "cto@prospect.com", subject: "x", body: "y" })).rejects.toThrow(RecipientNotAllowedError);
    expect(send).not.toHaveBeenCalled();
  });

  it("sendEmail always addresses MY_EMAIL and appends the live-test footer", async () => {
    let sent: OutgoingMail | null = null;
    __setSmtpSend(async (m) => { sent = m; });
    const r = await sendEmail({ subject: "Hello", body: "Hi Priya,", intendedRecipient: { fullName: "Priya R", email: "priya@acme.com", title: "CTO", company: "Acme" } });
    expect(r.status).toBe("sent");
    expect(sent!.to).toBe("me@example.com");
    expect(sent!.text).toContain("— Live test. Intended recipient: Priya R <priya@acme.com>, CTO at Acme");
    expect(r.threadId).toBe(r.messageId); // first message is the thread key
    expect(r.messageId).toMatch(/^<sprinto-.+@example\.com>$/);
  });

  it("replies thread via In-Reply-To / References", async () => {
    let sent: OutgoingMail | null = null;
    __setSmtpSend(async (m) => { sent = m; });
    const r = await sendEmail({ subject: "Re: Hello", body: "Hi", threadId: "<root@x>", inReplyTo: "<reply1@x>" });
    expect(sent!.inReplyTo).toBe("<reply1@x>");
    expect(sent!.references).toContain("<root@x>");
    expect(r.threadId).toBe("<root@x>");
  });

  it("retries transient SMTP failures twice, then reports send_failed", async () => {
    const send = vi.fn(async () => { throw Object.assign(new Error("ETIMEDOUT"), {}); });
    __setSmtpSend(send);
    const r = await sendEmail({ subject: "x", body: "y" });
    expect(r.status).toBe("send_failed");
    expect(send).toHaveBeenCalledTimes(3);
  }, 15_000);

  it("dry run never touches SMTP", async () => {
    const send = vi.fn();
    __setSmtpSend(send);
    const r = await sendEmail({ subject: "x", body: "y", dryRun: true });
    expect(r.status).toBe("dry_run");
    expect(send).not.toHaveBeenCalled();
  });

  it("strips quoted text from replies", () => {
    const t = "Sounds good, Thursday works.\n\nOn Wed, 18 Nov 2026 at 10:00, Dhivya <me@example.com> wrote:\n> Hi Priya,\n> ...";
    expect(stripQuoted(t)).toBe("Sounds good, Thursday works.");
  });
});
