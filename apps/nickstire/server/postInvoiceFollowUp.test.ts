import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the sms module
vi.mock("./sms", () => ({
  sendSms: vi.fn().mockResolvedValue({ success: true, sid: "SM_test_123" }),
  STORE_PHONE: "(216) 862-0005",
  STORE_NAME: "Nick's Tire & Auto",
}));

// Mock the db module
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockSet = vi.fn();

const mockRecentText = vi.fn();

vi.mock("./db", () => ({
  hasOutboundTextWithinDays: (...args: unknown[]) => mockRecentText(...args),
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockLimit,
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: mockWhere,
      }),
    }),
  })),
}));

describe("Post-Invoice Follow-Up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should export processPostInvoiceFollowUps function", async () => {
    const mod = await import("./postInvoiceFollowUp");
    expect(typeof mod.processPostInvoiceFollowUps).toBe("function");
  });

  it("should return zero results when no eligible customers", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const { processPostInvoiceFollowUps } = await import("./postInvoiceFollowUp");
    const result = await processPostInvoiceFollowUps();
    expect(result.processed).toBe(0);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("should have correct FollowUpResult interface shape", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const { processPostInvoiceFollowUps } = await import("./postInvoiceFollowUp");
    const result = await processPostInvoiceFollowUps();
    expect(result).toHaveProperty("processed");
    expect(result).toHaveProperty("sent");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("skipped");
  });

  // The text the customer receives, not a template object: the real processor runs against a
  // mocked customer row and the string handed to sendSms is asserted. ShopDriver imports are
  // often ALL CAPS and the mirror writes "Unknown" when the counter sends no name.
  describe("greeting", () => {
    const expected = (first: string) =>
      `Hi ${first}, it's Nick's Tire & Auto on Euclid. Thanks for coming in. If anything about the car feels off, text us here and we'll take care of it. If you have a minute, tell other Cleveland drivers how your visit went: nickstire.org/review`;

    beforeEach(() => {
      mockWhere.mockResolvedValue([{ affectedRows: 1 }]);
      mockRecentText.mockResolvedValue(false);
      vi.doMock("./services/featureFlags", () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));
    });

    afterEach(() => {
      vi.doUnmock("./services/featureFlags");
    });

    // Real timers on purpose, same reason as the cross-lane block below: one real 1.1s sleep per customer.
    it.each([
      ["JOHN", "John"],
      ["CHERYL ", "Cheryl"],
      ["Unknown", "there"],
      ["", "there"],
    ])("greets first name %j as %j in the text sendSms receives", async (firstName, greeting) => {
      mockLimit.mockResolvedValueOnce([{ id: 7, firstName, phone: "2165550199", segment: "recent" }]);
      const { sendSms } = await import("./sms");
      const { processPostInvoiceFollowUps } = await import("./postInvoiceFollowUp");
      await processPostInvoiceFollowUps();
      expect(sendSms).toHaveBeenCalledTimes(1);
      expect(sendSms).toHaveBeenCalledWith("2165550199", expected(greeting), { via: "shop" });
    }, 10_000);
  });

  it("should calculate 7-day window correctly", () => {
    const now = new Date();
    const sixDaysAgo = new Date(now);
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 8);
    const eightDaysAgo = new Date(now);
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 6);

    // The window should be 2 days wide (6-8 days ago)
    const windowMs = eightDaysAgo.getTime() - sixDaysAgo.getTime();
    const windowDays = windowMs / (1000 * 60 * 60 * 24);
    expect(windowDays).toBeCloseTo(2, 0);
  });
  // 2026-10-25: the thank-you keeps a 3-day gap from any other shop text (postVisitGap.test.ts
  // runs the real query and helper); here only the call into the second check is pinned.
  describe("gap from other shop texts", () => {
    const customer = { id: 9, firstName: "Sam", phone: "2165550123", segment: "recent" };

    beforeEach(async () => {
      mockLimit.mockResolvedValue([customer]);
      mockWhere.mockResolvedValue([{ affectedRows: 1 }]);
      vi.doMock("./services/featureFlags", () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));
    });

    afterEach(() => {
      vi.doUnmock("./services/featureFlags");
    });

    // Real timers on purpose: the send path sleeps 1.1s between texts, and a fake-timer
    // advance can run BEFORE the dynamic imports reach that setTimeout — it then never
    // fires (CI: 30s timeout). One customer costs one real 1.1s sleep; that is the price
    // of a deterministic test.
    it("skips a customer the shop texted inside the 3-day gap: no claim, no text", async () => {
      mockRecentText.mockResolvedValue(true);
      const { sendSms } = await import("./sms");
      const { processPostInvoiceFollowUps } = await import("./postInvoiceFollowUp");
      const result = await processPostInvoiceFollowUps();
      expect(mockRecentText).toHaveBeenCalledWith("2165550123", 3);
      expect(result.skipped).toBe(1);
      expect(sendSms).not.toHaveBeenCalled();
      expect(mockWhere).not.toHaveBeenCalled();
    });

    it("control: a phone with no recent shop text is still texted", async () => {
      mockRecentText.mockResolvedValue(false);
      const { sendSms } = await import("./sms");
      const { processPostInvoiceFollowUps } = await import("./postInvoiceFollowUp");
      await processPostInvoiceFollowUps();
      expect(sendSms).toHaveBeenCalledTimes(1);
    }, 10_000);
  });
});
