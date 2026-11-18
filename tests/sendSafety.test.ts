import { describe, it, expect, vi } from "vitest";
import { assertRecipient, sendEmail, buildRawMessage, __setGmailFactory, RecipientNotAllowedError } from "@/lib/google/gmail";

describe("send safety (live test mode)", () => {
  it("allows only MY_EMAIL", () => {
    expect(assertRecipient(undefined)).toBe("me@example.com");
    expect(assertRecipient("ME@example.com")).toBe("me@example.com");
    expect(() => assertRecipient("prospect@acme.com")).toThrow(RecipientNotAllowedError);
  });

  it("sendEmail throws for any other recipient and never calls Gmail", async () => {
    const send = vi.fn();
    __setGmailFactory(async () => ({ users: { messages: { send, get: vi.fn() } } }) as never);
    await expect(sendEmail({ to: "cto@prospect.com", subject: "x", body: "y" })).rejects.toThrow(RecipientNotAllowedError);
    expect(send).not.toHaveBeenCalled();
  });

  it("sendEmail always addresses MY_EMAIL and appends the live-test footer", async () => {
    let raw = "";
    const send = vi.fn(async (args: { requestBody: { raw: string } }) => { raw = args.requestBody.raw; return { data: { id: "m1", threadId: "t1" } }; });
    __setGmailFactory(async () => ({ users: { messages: { send, get: vi.fn(async () => ({ data: { payload: { headers: [] } } })) } } }) as never);
    const r = await sendEmail({ subject: "Hello", body: "Hi Priya,", intendedRecipient: { fullName: "Priya R", email: "priya@acme.com", title: "CTO", company: "Acme" } });
    expect(r.status).toBe("sent");
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toMatch(/^From: .*<me@example\.com>/m);
    expect(decoded).toMatch(/^To: me@example\.com\r?$/m);
    expect(decoded).not.toMatch(/^To: .*priya@acme\.com/m);
    expect(decoded).toContain("— Live test. Intended recipient: Priya R <priya@acme.com>, CTO at Acme");
  });

  it("dry run never calls Gmail", async () => {
    const send = vi.fn();
    __setGmailFactory(async () => ({ users: { messages: { send } } }) as never);
    const r = await sendEmail({ subject: "x", body: "y", dryRun: true });
    expect(r.status).toBe("dry_run");
    expect(send).not.toHaveBeenCalled();
  });

  it("raw message builder only has one To header", () => {
    const raw = Buffer.from(buildRawMessage({ to: "me@example.com", from: "me@example.com", subject: "s", body: "b" }), "base64url").toString();
    expect(raw.match(/^To:/gm)).toHaveLength(1);
    expect(raw).not.toMatch(/^(Cc|Bcc):/m);
  });
});
