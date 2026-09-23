/**
 * sendNotification's two optional fields (2026-09-23, careers intake audit):
 *
 *  - `html`: the email carries it while the owner push keeps the plain `body`.
 *    Plain text sent as Resend `html` collapsed every line break, so the
 *    owner alert and the applicant acknowledgement arrived as one paragraph.
 *  - `replyTo`: a confidential applicant's reply reaches the owner, not the
 *    shared shop inbox (SHOP_EMAIL stays the default).
 *
 * And the "Notification sent" log line names recipient domains only: an
 * acknowledgement goes to an address a member of the public typed.
 *
 * Only the Resend client and the owner push are mocked; sendNotification,
 * its routing and its circuit breaker run for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resendSends: Array<Record<string, unknown>> = [];
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (args: Record<string, unknown>) => {
        resendSends.push(args);
        return { data: { id: "msg_1" }, error: null };
      },
    };
  },
}));
vi.mock("./_core/notification", () => ({ notifyOwner: async () => true }));

const ENV_KEYS = ["RESEND_API_KEY", "SHOP_EMAIL"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  resendSends.length = 0;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.SHOP_EMAIL = "shop@example.com";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const { sendNotification } = await import("./email-notify");

describe("sendNotification html + replyTo", () => {
  it("sends `html` as the email when given, and honours replyTo", async () => {
    const res = await sendNotification({
      category: "follow_up",
      subject: "s",
      body: "line one\nline two",
      html: "<div>line one<br>line two</div>",
      replyTo: "owner@example.com",
      overrideTo: ["applicant@example.com"],
      bypassThrottle: true,
    });
    expect(res.emailSent).toBe(true);
    expect(resendSends[0].html).toBe("<div>line one<br>line two</div>");
    expect(resendSends[0].replyTo).toBe("owner@example.com");
  });

  it("control: without the new fields, body is the email and SHOP_EMAIL the reply-to (unchanged)", async () => {
    await sendNotification({
      category: "follow_up",
      subject: "s",
      body: "<p>already html</p>",
      overrideTo: ["someone@example.com"],
      bypassThrottle: true,
    });
    expect(resendSends[0].html).toBe("<p>already html</p>");
    expect(resendSends[0].replyTo).toBe("shop@example.com");
  });

  it("logs recipient domains, never the address", async () => {
    const lines: string[] = [];
    const out = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => (lines.push(String(c)), true));
    try {
      await sendNotification({
        category: "follow_up",
        subject: "s",
        body: "b",
        overrideTo: ["sam.applicant@example.com"],
        bypassThrottle: true,
      });
    } finally {
      out.mockRestore();
    }
    const sentLine = lines.find((l) => l.includes("Notification sent")) ?? "";
    expect(sentLine).toContain("*@example.com");
    expect(sentLine).not.toContain("sam.applicant");
  });
});
