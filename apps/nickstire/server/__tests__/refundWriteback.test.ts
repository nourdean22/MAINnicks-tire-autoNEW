import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoices } from "../../drizzle/schema";

// Prevent mock pollution from other test files in singleFork serial mode —
// this file needs the REAL drizzle schema.
vi.unmock("../../drizzle/schema");

// Mock the database helper
const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();

const mockDbInstance = {
  execute: mockExecute,
  select: mockSelect,
  update: mockUpdate,
};

vi.mock("../lib/db-helper", () => ({
  db: vi.fn().mockResolvedValue(mockDbInstance),
}));

// Mock the audit trail
const mockLogAdminAction = vi.fn();
vi.mock("../services/auditTrail", () => ({
  logAdminAction: mockLogAdminAction,
}));

// Mock shopDriverMirror getSession
const mockGetSession = vi.fn();
vi.mock("../services/shopDriverMirror", () => ({
  getSession: mockGetSession,
}));

// Mock global fetch — stubbed per test and restored after, so the stub can
// never leak into other files in singleFork serial mode.
const mockFetch = vi.fn();

describe("Stripe Refund Writeback to ShopDriver Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should skip writeback if invoiceNumber is missing in metadata", async () => {
    const { processStripeRefundEvent } = await import("../services/refundWriteback");

    const mockEvent = {
      data: {
        object: {
          id: "ch_123",
          amount_refunded: 5000,
          metadata: {}, // no invoiceNumber
        },
      },
    };

    const result = await processStripeRefundEvent(mockEvent);

    expect(result.success).toBe(true);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("should fail if invoice is not found in database", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]), // invoice not found
    });

    const { processStripeRefundEvent } = await import("../services/refundWriteback");

    const mockEvent = {
      data: {
        object: {
          id: "ch_123",
          amount_refunded: 5000,
          metadata: {
            invoiceNumber: "INV-12345",
          },
        },
      },
    };

    const result = await processStripeRefundEvent(mockEvent);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invoice INV-12345 not found");
  });

  it("should process the database update and skip ShopDriver sync if algTicketId is not present", async () => {
    const mockInvoice = {
      id: 555,
      invoiceNumber: "INV-12345",
      paymentStatus: "paid",
      algTicketId: null, // no ticket linked
    };

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockInvoice]),
    });

    // Mock DB execute showing 1 row affected (claim successful)
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    const { processStripeRefundEvent } = await import("../services/refundWriteback");

    const mockEvent = {
      data: {
        object: {
          id: "ch_123",
          amount_refunded: 5000,
          metadata: {
            invoiceNumber: "INV-12345",
            actor: "admin@nickstire.com",
            refundReason: "Customer request",
          },
        },
      },
    };

    const result = await processStripeRefundEvent(mockEvent);

    expect(result.success).toBe(true);
    expect(mockExecute).toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled(); // no shopdriver API call
    expect(mockLogAdminAction).toHaveBeenCalledWith({
      action: "invoice.refunded",
      entityType: "invoices",
      entityId: 555,
      details: expect.stringContaining("Refunded $50.00 for invoice INV-12345. No ShopDriver ticket linked."),
      actor: "admin@nickstire.com",
      previousValue: "paid",
      newValue: "refunded",
      metadata: expect.objectContaining({
        stripeChargeId: "ch_123",
        amountCents: 5000,
      }),
    });
  });

  it("should sync the refund to ShopDriver Elite API when algTicketId is present", async () => {
    const mockInvoice = {
      id: 555,
      invoiceNumber: "INV-12345",
      paymentStatus: "paid",
      algTicketId: "alg_ticket_999",
    };

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockInvoice]),
    });

    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
    mockGetSession.mockResolvedValue("test_session_token_123");
    mockFetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(""),
    });

    const { processStripeRefundEvent } = await import("../services/refundWriteback");

    const mockEvent = {
      data: {
        object: {
          id: "ch_123",
          amount_refunded: 5000,
          metadata: {
            invoiceNumber: "INV-12345",
            actor: "admin@nickstire.com",
            refundReason: "Customer request",
          },
        },
      },
    };

    const result = await processStripeRefundEvent(mockEvent);

    expect(result.success).toBe(true);
    expect(mockGetSession).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com/api/v1/tickets/alg_ticket_999/refund",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test_session_token_123",
        }),
        body: JSON.stringify({
          amountCents: 5000,
          reason: "Customer request",
        }),
      })
    );

    expect(mockLogAdminAction).toHaveBeenCalledWith({
      action: "invoice.refunded",
      entityType: "invoices",
      entityId: 555,
      details: expect.stringContaining("Refunded $50.00 for invoice INV-12345. Synced to ShopDriver ticket alg_ticket_999."),
      actor: "admin@nickstire.com",
      previousValue: "paid",
      newValue: "refunded",
      metadata: expect.objectContaining({
        stripeChargeId: "ch_123",
        amountCents: 5000,
        algTicketId: "alg_ticket_999",
      }),
    });
  });

  it("should record refund_failed audit log if ShopDriver API call fails", async () => {
    const mockInvoice = {
      id: 555,
      invoiceNumber: "INV-12345",
      paymentStatus: "paid",
      algTicketId: "alg_ticket_999",
    };

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockInvoice]),
    });

    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
    mockGetSession.mockResolvedValue("test_session_token_123");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue("Internal Server Error"),
    });

    const { processStripeRefundEvent } = await import("../services/refundWriteback");

    const mockEvent = {
      data: {
        object: {
          id: "ch_123",
          amount_refunded: 5000,
          metadata: {
            invoiceNumber: "INV-12345",
            actor: "admin@nickstire.com",
            refundReason: "Customer request",
          },
        },
      },
    };

    const result = await processStripeRefundEvent(mockEvent);

    expect(result.success).toBe(false);
    expect(result.error).toContain("ShopDriver API returned HTTP 500");
    expect(mockLogAdminAction).toHaveBeenCalledWith({
      action: "invoice.refund_failed",
      entityType: "invoices",
      entityId: 555,
      details: expect.stringContaining("Refund writeback failed for invoice INV-12345. Error: ShopDriver API returned HTTP 500"),
      actor: "admin@nickstire.com",
      previousValue: "paid",
      newValue: "paid",
      metadata: expect.objectContaining({
        stripeChargeId: "ch_123",
        amountCents: 5000,
        error: "ShopDriver API returned HTTP 500",
      }),
    });
  });
});
