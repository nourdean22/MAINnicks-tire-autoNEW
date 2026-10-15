/**
 * A failed send is logged as "email send failed". Sends go through Resend, and the
 * old "Gmail MCP send failed" wording pointed whoever reads the log at a provider
 * the shop no longer sends through. The error text stays in the log line.
 *
 * Only the Resend client and the owner push are mocked. sendNotification, its
 * routing and the circuit breaker run for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async () => ({ data: null, error: { message: "simulated provider outage" } }),
    };
  },
}));
vi.mock("./_core/notification", () => ({ notifyOwner: async () => true }));

const ENV_KEYS = ["RESEND_API_KEY", "SHOP_EMAIL"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
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

describe("failed email sends", () => {
  it("are logged as 'email send failed', keeping the error, and not under the Gmail wording", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const o = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => (out.push(String(c)), true));
    const e = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => (err.push(String(c)), true));
    try {
      await sendNotification({
        category: "follow_up",
        subject: "s",
        body: "b",
        overrideTo: ["someone@example.com"],
        bypassThrottle: true,
      });
    } finally {
      o.mockRestore();
      e.mockRestore();
    }
    const logged = [...out, ...err].join("");
    expect(logged).toContain("email send failed");
    expect(logged).toContain("simulated provider outage");
    expect(logged).not.toContain("Gmail MCP send failed");
  });
});
