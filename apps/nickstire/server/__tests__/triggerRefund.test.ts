import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

// Use vi.hoisted to ensure all mocks are created before any imports are evaluated
const {
  mockExecute,
  mockSelect,
  mockUpdate,
  mockDbInstance,
  mockLogAdminAction,
  mockRetrieve,
  mockSearch,
  mockRefundCreate,
  mockProcessStripeRefundEvent
} = vi.hoisted(() => {
  const mockExecute = vi.fn();
  const mockSelect = vi.fn();
  const mockUpdate = vi.fn();
  return {
    mockExecute,
    mockSelect,
    mockUpdate,
    mockDbInstance: {
      execute: mockExecute,
      select: mockSelect,
      update: mockUpdate,
    },
    mockLogAdminAction: vi.fn(),
    mockRetrieve: vi.fn(),
    mockSearch: vi.fn(),
    mockRefundCreate: vi.fn(),
    mockProcessStripeRefundEvent: vi.fn(),
  };
});

vi.mock("../lib/db-helper", () => ({
  db: vi.fn().mockResolvedValue(mockDbInstance),
}));

vi.mock("../services/auditTrail", () => ({
  logAdminAction: mockLogAdminAction,
}));

vi.mock("stripe", () => {
  return {
    default: class MockStripe {
      checkout = {
        sessions: {
          retrieve: mockRetrieve,
        },
      };
      paymentIntents = {
        search: mockSearch,
      };
      refunds = {
        create: mockRefundCreate,
      };
      constructor(key: string) {}
    },
  };
});

vi.mock("../services/refundWriteback", () => ({
  processStripeRefundEvent: mockProcessStripeRefundEvent,
}));

// Now import appRouter safely
import { appRouter } from "../routers";

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-openid",
      name: "Admin User",
      email: "admin@nickstire.com",
      loginMethod: "manus",
      role: "admin",
      loyaltyPoints: 0,
      loyaltyTier: "bronze",
      totalVisits: 0,
      totalSpent: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as any,
    res: {} as any,
  };
}

describe("tRPC invoices.triggerRefund procedure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "test_stripe_secret_key";
  });

  it("should throw error if invoice is not found", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });

    const caller = appRouter.createCaller(createAdminContext());

    let thrownError: any;
    try {
      await caller.invoices.triggerRefund({
        invoiceId: 999,
        amountCents: 5000,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError.message).toContain("Invoice ID 999 not found");
  });

  it("should throw error if invoice status is not paid or partial", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 555,
          invoiceNumber: "INV-12345",
          paymentStatus: "pending",
        },
      ]),
    });

    const caller = appRouter.createCaller(createAdminContext());

    let thrownError: any;
    try {
      await caller.invoices.triggerRefund({
        invoiceId: 555,
        amountCents: 5000,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError.message).toContain("Invoice payment status is pending, cannot refund");
  });

  it("should issue Stripe refund and call writeback service successfully", async () => {
    const mockInvoice = {
      id: 555,
      invoiceNumber: "INV-12345",
      paymentStatus: "paid",
      algTicketId: "alg_ticket_999",
    };

    const mockTireOrder = {
      orderNumber: "TO-999",
      stripeSessionId: "cs_123",
      invoiceNumber: "INV-12345",
    };

    // First select is for invoice lookup
    // Second select (when checking tire order) is for tireOrders
    mockSelect.mockImplementation((table: any) => {
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(async () => {
          // Check if looking up invoice or tireOrder
          if (mockSelect.mock.calls.length === 1) {
            return [mockInvoice];
          } else {
            return [mockTireOrder];
          }
        }),
      };
    });

    mockRetrieve.mockResolvedValue({
      payment_intent: "pi_123",
    });

    mockRefundCreate.mockResolvedValue({
      id: "re_123",
    });

    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);
    const mockUpdateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    };
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockProcessStripeRefundEvent.mockResolvedValue({ success: true });

    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.invoices.triggerRefund({
      invoiceId: 555,
      amountCents: 5000,
      reason: "Customer request",
    });

    expect(result.success).toBe(true);
    expect(result.refundId).toBe("re_123");
    expect(result.writebackSuccess).toBe(true);

    expect(mockRetrieve).toHaveBeenCalledWith("cs_123");
    expect(mockRefundCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: "pi_123",
        amount: 5000,
        metadata: expect.objectContaining({
          invoiceId: "555",
          invoiceNumber: "INV-12345",
          refundReason: "Customer request",
          actor: "admin@nickstire.com",
        }),
      }),
      expect.objectContaining({
        idempotencyKey: "refund-inv-555-5000",
      })
    );

    expect(mockExecute).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockProcessStripeRefundEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          object: expect.objectContaining({
            amount_refunded: 5000,
            metadata: expect.objectContaining({
              invoiceNumber: "INV-12345",
              actor: "admin@nickstire.com",
            }),
          }),
        }),
      })
    );
  });
});
