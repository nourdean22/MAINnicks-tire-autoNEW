/**
 * RUN FOLLOW-UPS must never burn a customer it did not text (audit F-1).
 *
 * The defect: `process24hFollowUps` claimed `bookings.followUp24hSent = 1`
 * BEFORE checking the sms_review_requests flag, then incremented `processed`
 * unconditionally — so with the flag off every press permanently consumed up
 * to 20 bookings, sent nothing, and the admin toasted "Processed 20 follow-ups".
 *
 * Canary shape: each case asserts the receipt AND the side effect that must
 * (not) happen, so a regression that restores the old order fails here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendSms = vi.fn();
const isEnabled = vi.fn();
const notifyOwner = vi.fn(async () => undefined);
const createCustomerNotification = vi.fn(async () => ({ id: 77 }));
const markNotificationSent = vi.fn(async () => undefined);
const markNotificationFailed = vi.fn(async () => undefined);
const update = vi.fn();
let rows: Array<Record<string, unknown>> = [];

vi.mock("./sms", () => ({
  sendSms: (...args: unknown[]) => sendSms(...args),
  thankYouSms: () => "thanks",
  reviewRequestSms: () => "review please",
}));
vi.mock("./services/featureFlags", () => ({ isEnabled: (...a: unknown[]) => isEnabled(...a) }));
vi.mock("./_core/notification", () => ({ notifyOwner: (...a: unknown[]) => notifyOwner(...a) }));
vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
    update: (...a: unknown[]) => {
      update(...a);
      return { set: () => ({ where: async () => [{ affectedRows: 1 }] }) };
    },
  }),
  createCustomerNotification: (...a: unknown[]) => createCustomerNotification(...a),
  markNotificationSent: (...a: unknown[]) => markNotificationSent(...a),
  markNotificationFailed: (...a: unknown[]) => markNotificationFailed(...a),
}));

const booking = (id: number, phone: string | null = "2165550100") => ({
  id, name: "Test Customer", phone, email: null, service: "tires", status: "completed",
  followUp24hSent: 0, followUp7dSent: 0, updatedAt: new Date(0),
});

describe("follow-ups · receipts come from outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [booking(1), booking(2), booking(3)];
  });

  it("flag OFF: claims NOTHING, sends nothing, reports skipped with the reason", async () => {
    isEnabled.mockResolvedValue(false);
    const { process24hFollowUps } = await import("./follow-ups");
    const r = await process24hFollowUps();
    expect(update).not.toHaveBeenCalled();            // no booking burned
    expect(sendSms).not.toHaveBeenCalled();
    expect(createCustomerNotification).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: 0, queued: 0, failed: 0, skipped: 3 });
    expect(r.skipReason).toMatch(/sms_review_requests is off/);
  });

  it("delivered: claims, sends, marks the notification sent, counts as sent", async () => {
    isEnabled.mockResolvedValue(true);
    sendSms.mockResolvedValue({ success: true, sid: "SM1" });
    const { process24hFollowUps } = await import("./follow-ups");
    const r = await process24hFollowUps();
    expect(update).toHaveBeenCalledTimes(3);
    expect(sendSms).toHaveBeenCalledTimes(3);
    expect(markNotificationSent).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ sent: 3, queued: 0, failed: 0, skipped: 0 });
  });

  it("queued for the 8 AM window: counted as queued, NOT as sent, notification left pending", async () => {
    isEnabled.mockResolvedValue(true);
    sendSms.mockResolvedValue({ success: true, queued: true });
    const { process24hFollowUps } = await import("./follow-ups");
    const r = await process24hFollowUps();
    expect(markNotificationSent).not.toHaveBeenCalled();
    expect(markNotificationFailed).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: 0, queued: 3, failed: 0 });
  });

  it("gateway failure: counted as failed and the notification is marked failed (never 'sent')", async () => {
    isEnabled.mockResolvedValue(true);
    sendSms.mockResolvedValue({ success: false, error: "gateway down" });
    const { process24hFollowUps } = await import("./follow-ups");
    const r = await process24hFollowUps();
    expect(markNotificationSent).not.toHaveBeenCalled();
    expect(markNotificationFailed).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ sent: 0, queued: 0, failed: 3 });
  });

  it("no phone: nothing sent, notification marked failed, counted as skipped", async () => {
    isEnabled.mockResolvedValue(true);
    rows = [booking(9, null)];
    const { process24hFollowUps } = await import("./follow-ups");
    const r = await process24hFollowUps();
    expect(sendSms).not.toHaveBeenCalled();
    expect(markNotificationFailed).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
  });

  it("runFollowUps: `total` equals texts SENT, and the owner report carries the breakdown", async () => {
    isEnabled.mockResolvedValue(true);
    sendSms
      .mockResolvedValueOnce({ success: true, sid: "a" })
      .mockResolvedValueOnce({ success: true, queued: true })
      .mockResolvedValueOnce({ success: false });
    rows = [booking(1), booking(2), booking(3)];
    const { runFollowUps } = await import("./follow-ups");
    // second lane (7d) sees the same three rows again in this mock; make them all fail
    sendSms.mockResolvedValue({ success: false });
    const r = await runFollowUps();
    expect(r.total).toBe(r.sent);
    expect(r.sent).toBe(1);
    expect(r.queued).toBe(1);
    expect(r.failed).toBe(4);
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    const arg = notifyOwner.mock.calls[0][0] as { title: string };
    expect(arg.title).toMatch(/1 sent · 1 queued · 4 failed/);
  });

  it("runFollowUps with the flag off reports the skip reason and notifies nobody", async () => {
    isEnabled.mockResolvedValue(false);
    const { runFollowUps } = await import("./follow-ups");
    const r = await runFollowUps();
    expect(r.total).toBe(0);
    expect(r.skipped).toBe(6);
    expect(r.skipReason).toMatch(/off/);
    expect(notifyOwner).not.toHaveBeenCalled();
  });
});
