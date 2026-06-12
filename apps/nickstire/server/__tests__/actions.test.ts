import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock out the core dependency functions of actions.ts
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockD = {
  insert: () => ({
    values: mockInsert,
  }),
  select: () => ({
    from: () => ({
      where: () => ({
        limit: mockSelect,
      }),
    }),
  }),
};

const mockFetchSessionWithMessages = vi.fn();
const mockFindReturningCustomer = vi.fn();
const mockInvokeLLM = vi.fn();

vi.mock("../routers/nick/utils", () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  db: vi.fn(),
  fetchSessionWithMessages: (...args: any[]) => mockFetchSessionWithMessages(...args),
  findReturningCustomer: (...args: any[]) => mockFindReturningCustomer(...args),
  matchTechnician: vi.fn(() => ({ tech: { name: "John", id: 1 }, confidence: 0.9, reason: "matched" })),
  suggestBay: vi.fn(() => ({ bay: "Bay 1", confidence: 0.9, reason: "matched" })),
  estimateCompletionHours: vi.fn(() => ({ readyBy: "2026-06-11T18:00:00.000Z", confidence: 0.9 })),
  validateCurrency: vi.fn((val) => val),
  validateString: vi.fn((val) => val),
  validateScore: vi.fn((val) => val),
  PARTS_KB: {},
}));

vi.mock("../_core/llm", () => ({
  invokeLLM: (...args: any[]) => mockInvokeLLM(...args),
}));

describe("handleCreateWorkOrder validation tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchSessionWithMessages.mockResolvedValue({
      d: mockD,
      session: { leadId: 123 },
      messages: [],
      conversationText: "Customer complaint text",
    });
    mockFindReturningCustomer.mockResolvedValue({
      history: { isReturning: false, totalVisits: 0 },
      customer: null,
    });
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              customerComplaint: "AC not blowing cold",
              diagnosis: "Leak in condenser",
              vehicleYear: 2018,
              vehicleMake: "Honda",
              vehicleModel: "Civic",
              vehicleMileage: 50000,
              recommendedServices: ["AC Charge", "Condenser replacement"],
              estimatedHours: 3.5,
              urgencyNote: "needs soon",
              urgencyScore: 3,
              serviceCategories: ["ac"],
              partsToOrder: [],
            }),
          },
        },
      ],
    });
    mockInsert.mockResolvedValue({ id: "1" });
    mockSelect.mockResolvedValue([{ id: "1" }]);
  });

  it("successfully creates a walk-in / AI work order with customerId = null", async () => {
    const { handleCreateWorkOrder } = await import("../routers/nick/actions");
    const result = await handleCreateWorkOrder({
      sessionId: 1001,
      customerId: undefined, // walk-in
      priority: "normal",
      autoAssign: true,
    });
    expect(result).toBeDefined();
    expect(result.customerId).toBeNull();
  });

  it("successfully creates a customer-linked work order with a valid numeric customerId", async () => {
    const { handleCreateWorkOrder } = await import("../routers/nick/actions");
    const result = await handleCreateWorkOrder({
      sessionId: 1001,
      customerId: 42, // valid ID
      priority: "normal",
      autoAssign: true,
    });
    expect(result).toBeDefined();
    expect(result.customerId).toBe(42);
  });

  it("rejects an invalid customerId = 0 with an error", async () => {
    const { handleCreateWorkOrder } = await import("../routers/nick/actions");
    try {
      await handleCreateWorkOrder({
        sessionId: 1001,
        customerId: 0,
        priority: "normal",
        autoAssign: true,
      });
      throw new Error("Should have thrown");
    } catch (err: any) {
      expect(err.message).toBe("Invalid customerId: must be a finite positive integer");
    }
  });

  it("rejects an invalid customerId = NaN with an error", async () => {
    const { handleCreateWorkOrder } = await import("../routers/nick/actions");
    try {
      await handleCreateWorkOrder({
        sessionId: 1001,
        customerId: NaN,
        priority: "normal",
        autoAssign: true,
      });
      throw new Error("Should have thrown");
    } catch (err: any) {
      expect(err.message).toBe("Invalid customerId: must be a finite positive integer");
    }
  });

  it("rejects a string input that represents a phone or text by throwing (coerced or typed bypassed)", async () => {
    const { handleCreateWorkOrder } = await import("../routers/nick/actions");
    try {
      await handleCreateWorkOrder({
        sessionId: 1001,
        customerId: "WALK-IN" as any,
        priority: "normal",
        autoAssign: true,
      });
      throw new Error("Should have thrown");
    } catch (err: any) {
      expect(err.message).toBe("Invalid customerId: must be a finite positive integer");
    }

    try {
      await handleCreateWorkOrder({
        sessionId: 1001,
        customerId: "2165551234" as any,
        priority: "normal",
        autoAssign: true,
      });
      throw new Error("Should have thrown");
    } catch (err: any) {
      expect(err.message).toBe("Invalid customerId: must be a finite positive integer");
    }
  });
});
