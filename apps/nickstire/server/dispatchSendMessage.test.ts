/**
 * dispatch.sendMessage must SEND and record the OUTCOME (audit F-2).
 *
 * Before 2026-09-01 the procedure called logStatusMessage({ status: "sent" })
 * and never invoked any SMS sender — a mounted admin mutation named
 * "sendMessage" that wrote a receipt for an event that did not happen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendSms = vi.fn();
const inserted: Array<Record<string, unknown>> = [];

vi.mock("./sms", () => ({ sendSms: (...a: unknown[]) => sendSms(...a) }));
vi.mock("./db", () => ({
  getDb: async () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return { $returningId: async () => [{ id: inserted.length }] };
      },
    }),
  }),
}));

describe("sendWorkOrderStatusMessage", () => {
  beforeEach(() => { vi.clearAllMocks(); inserted.length = 0; });

  const base = { workOrderId: "wo-1", trigger: "ready", recipient: "2165550100", message: "Your car is ready" };

  it("sends through the shop gateway as a transactional confirmation and records 'sent'", async () => {
    sendSms.mockResolvedValue({ success: true, sid: "SM1" });
    const { sendWorkOrderStatusMessage } = await import("./services/customerMessaging");
    const r = await sendWorkOrderStatusMessage(base);
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0][2]).toMatchObject({ via: "shop", messageClass: "customer_confirmation", humanInitiated: true });
    expect(r.outcome).toBe("sent");
    expect(inserted[0]).toMatchObject({ status: "sent", workOrderId: "wo-1" });
    expect(inserted[0].sentAt).toBeInstanceOf(Date);
  });

  it("records 'failed' (never 'sent') when the gateway refuses", async () => {
    sendSms.mockResolvedValue({ success: false, error: "gateway offline" });
    const { sendWorkOrderStatusMessage } = await import("./services/customerMessaging");
    const r = await sendWorkOrderStatusMessage(base);
    expect(r.outcome).toBe("failed");
    expect(r.error).toBe("gateway offline");
    expect(inserted[0]).toMatchObject({ status: "failed", sentAt: null });
  });

  it("records 'failed' when the sender throws — a thrown send is not a sent message", async () => {
    sendSms.mockRejectedValue(new Error("boom"));
    const { sendWorkOrderStatusMessage } = await import("./services/customerMessaging");
    const r = await sendWorkOrderStatusMessage(base);
    expect(r.outcome).toBe("failed");
    expect(inserted[0]).toMatchObject({ status: "failed" });
  });

  it("a non-SMS channel is logged as a suggestion, not claimed as sent", async () => {
    const { sendWorkOrderStatusMessage } = await import("./services/customerMessaging");
    const r = await sendWorkOrderStatusMessage({ ...base, channel: "email" });
    expect(sendSms).not.toHaveBeenCalled();
    expect(inserted[0]).toMatchObject({ status: "suggested", channel: "email" });
    expect(r.outcome).toBe("failed");
  });
});
