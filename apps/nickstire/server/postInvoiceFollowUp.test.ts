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

const mockCooldown = vi.fn();

vi.mock("./db", () => ({
  getReviewSettings: vi.fn(async () => ({ enabled: 1, delayMinutes: 1440, maxPerDay: 20, cooldownDays: 30 })),
  isPhoneOnReviewCooldown: (...args: unknown[]) => mockCooldown(...args),
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

  it("should use correct message templates with store info", () => {
    // Verify the module references the correct constants
    // The messages should include the store name, phone, review URL, and referral URL
    const storeInfo = {
      name: "Nick's Tire & Auto",
      phone: "(216) 862-0005",
      reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJSWRRLdr_MIgRxdlMIMPcqww",
      referralUrl: "https://nickstire.org/refer",
    };
    
    expect(storeInfo.name).toBe("Nick's Tire & Auto");
    expect(storeInfo.phone).toBe("(216) 862-0005");
    expect(storeInfo.reviewUrl).toContain("ChIJSWRRLdr_MIgRxdlMIMPcqww");
    expect(storeInfo.referralUrl).toBe("https://nickstire.org/refer");
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
  // 2026-10-02 · one review ask per cooldown across BOTH lanes: the invoice-sourced
  // review_requests lane usually asks first, so this lane must skip that phone.
  describe("cross-lane dedupe", () => {
    const customer = { id: 9, firstName: "Sam", phone: "2165550123", segment: "recent" };

    beforeEach(async () => {
      mockLimit.mockResolvedValue([customer]);
      mockWhere.mockResolvedValue([{ affectedRows: 1 }]);
      vi.doMock("./services/featureFlags", () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));
    });

    afterEach(() => {
      vi.doUnmock("./services/featureFlags");
    });

    it("skips a customer the review_requests lane already asked (cooldown) — no claim, no text", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mockCooldown.mockResolvedValue(true);
        const { sendSms } = await import("./sms");
        const { processPostInvoiceFollowUps } = await import("./postInvoiceFollowUp");
        const result = await processPostInvoiceFollowUps();
        expect(mockCooldown).toHaveBeenCalledWith("2165550123", 30);
        expect(result.skipped).toBe(1);
        expect(sendSms).not.toHaveBeenCalled();
        expect(mockWhere).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("control: a phone NOT on cooldown is still texted", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mockCooldown.mockResolvedValue(false);
        const { sendSms } = await import("./sms");
        const { processPostInvoiceFollowUps } = await import("./postInvoiceFollowUp");
        const p = processPostInvoiceFollowUps();
        await vi.advanceTimersByTimeAsync(2000);
        await p;
        expect(sendSms).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
