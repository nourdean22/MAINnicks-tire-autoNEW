import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { tireOrders, invoices } from "../../drizzle/schema";

// Prevent mock pollution from other test files in singleFork serial mode —
// this file needs the REAL drizzle schema.
vi.unmock("../../drizzle/schema");

const ORIG_STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

// Mock the database helper
const mockExecute = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();

const mockDbInstance = {
  execute: mockExecute,
  update: mockUpdate,
  select: mockSelect,
};

vi.mock("../db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDbInstance),
}));

// Mock the audit trail
const mockLogAdminAction = vi.fn();
vi.mock("../services/auditTrail", () => ({
  logAdminAction: mockLogAdminAction,
}));

// Mock Stripe
const mockRetrieve = vi.fn();
const mockRefundCreate = vi.fn();

vi.mock("stripe", () => {
  return {
    default: class MockStripe {
      checkout = {
        sessions: {
          retrieve: mockRetrieve,
        },
      };
      refunds = {
        create: mockRefundCreate,
      };
      constructor(key: string) {}
    },
  };
});

describe("Stripe Refund & Database Writeback Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "test_stripe_secret_key";
  });

  afterAll(() => {
    if (ORIG_STRIPE_SECRET_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = ORIG_STRIPE_SECRET_KEY;
  });

  it("should fail when order does not exist in the database", async () => {
    // Mock database select returning empty array
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });

    const { refundTireOrderPayment } = await import("../services/payments");
    const result = await refundTireOrderPayment({
      orderNumber: "TO-12345",
      reason: "Customer cancelled",
      actorEmail: "admin@nickstire.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Order TO-12345 not found");
  });

  it("should fail if order payment status is not paid", async () => {
    // Mock database select returning an unpaid order
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        orderNumber: "TO-12345",
        paymentStatus: "pending",
        stripeSessionId: "cs_123",
      }]),
    });

    const { refundTireOrderPayment } = await import("../services/payments");
    const result = await refundTireOrderPayment({
      orderNumber: "TO-12345",
      reason: "Customer cancelled",
      actorEmail: "admin@nickstire.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Order TO-12345 is not paid (status: pending)");
  });

  it("should fail if there is no Stripe session associated with the order", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        orderNumber: "TO-12345",
        paymentStatus: "paid",
        stripeSessionId: null,
      }]),
    });

    const { refundTireOrderPayment } = await import("../services/payments");
    const result = await refundTireOrderPayment({
      orderNumber: "TO-12345",
      reason: "Customer cancelled",
      actorEmail: "admin@nickstire.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("No Stripe session ID associated with order TO-12345");
  });

  it("should process the refund successfully, update DB, and log the action", async () => {
    const mockOrder = {
      id: 999,
      orderNumber: "TO-12345",
      paymentStatus: "paid",
      stripeSessionId: "cs_123",
      totalAmount: 15000, // cents
      adminNotes: "Previous notes",
      invoiceNumber: "INV-999",
    };

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockOrder]),
    });

    // Mock Stripe checkout session retrieve to return a payment intent
    mockRetrieve.mockResolvedValue({
      payment_intent: "pi_123",
    });

    // Mock Stripe refund creation
    mockRefundCreate.mockResolvedValue({
      id: "re_123",
    });

    // Mock DB execution of SQL update (affectedRows = 1)
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    const mockUpdateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    };
    mockUpdate.mockReturnValue(mockUpdateChain);

    const { refundTireOrderPayment } = await import("../services/payments");
    const result = await refundTireOrderPayment({
      orderNumber: "TO-12345",
      reason: "Customer cancelled",
      actorEmail: "admin@nickstire.com",
    });

    expect(result.success).toBe(true);
    expect(result.refundId).toBe("re_123");

    // Check Stripe retrieve & create args
    expect(mockRetrieve).toHaveBeenCalledWith("cs_123");
    expect(mockRefundCreate).toHaveBeenCalledWith({
      payment_intent: "pi_123",
      reason: "requested_by_customer",
      metadata: {
        orderNumber: "TO-12345",
        refundReason: "Customer cancelled",
        actor: "admin@nickstire.com",
      },
    }, {
      idempotencyKey: "refund-TO-12345",
    });

    // Check Drizzle updates were executed
    expect(mockExecute).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(tireOrders);
    expect(mockUpdate).toHaveBeenCalledWith(invoices);

    // Check audit trail logging
    expect(mockLogAdminAction).toHaveBeenCalledWith({
      action: "tireorder.refunded",
      entityType: "tire_orders",
      entityId: 999,
      details: expect.stringContaining("Refunded $150.00 for order TO-12345"),
      actor: "admin@nickstire.com",
      previousValue: "paid",
      newValue: "refunded",
      metadata: expect.objectContaining({
        stripeRefundId: "re_123",
        amountCents: 15000,
        reason: "Customer cancelled",
      }),
    });
  });

  it("should record a failed audit trail log if Stripe API throws an error", async () => {
    const mockOrder = {
      id: 999,
      orderNumber: "TO-12345",
      paymentStatus: "paid",
      stripeSessionId: "cs_123",
      totalAmount: 15000,
    };

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockOrder]),
    });

    mockRetrieve.mockRejectedValue(new Error("Stripe API rate limit exceeded"));

    const { refundTireOrderPayment } = await import("../services/payments");
    const result = await refundTireOrderPayment({
      orderNumber: "TO-12345",
      reason: "Customer cancelled",
      actorEmail: "admin@nickstire.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Stripe API rate limit exceeded");

    // Check failed audit log was written
    expect(mockLogAdminAction).toHaveBeenCalledWith({
      action: "tireorder.refund_failed",
      entityType: "tire_orders",
      entityId: 999,
      details: expect.stringContaining("Refund failed for order TO-12345. Reason: Customer cancelled. Error: Stripe API rate limit exceeded"),
      actor: "admin@nickstire.com",
      previousValue: "paid",
      newValue: "paid",
      metadata: expect.objectContaining({
        error: "Stripe API rate limit exceeded",
        amountCents: 15000,
        reason: "Customer cancelled",
      }),
    });
  });
});
