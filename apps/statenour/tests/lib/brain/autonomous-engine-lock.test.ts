/**
 * Autonomous engine lock-first-then-fire tests · Track B.3
 *
 * Checks that the rule loop runs idempotentCreate() to lock the slot
 * before firing the side-effect (action).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  autonomousAction: {
    findFirst: vi.fn(),
    update: vi.fn(),
    groupBy: vi.fn(),
  },
  idempotentCreate: vi.fn(),
  idempotencyRecipe: {
    autonomousAction: vi.fn(() => "mock-idempotency-key"),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    autonomousAction: mocks.autonomousAction,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: vi.fn(() => ({
      warn: vi.fn((msg, meta) => {
        console.log(`LOG WARN: ${msg}`, JSON.stringify(meta));
      }),
      error: vi.fn((msg, meta) => {
        console.log(`LOG ERROR: ${msg}`, JSON.stringify(meta));
      }),
      info: vi.fn(),
    })),
  },
}));

vi.mock("@/lib/db/idempotency", () => ({
  idempotentCreate: mocks.idempotentCreate,
  idempotencyRecipe: mocks.idempotencyRecipe,
}));

const mockQueryNick = vi.fn().mockImplementation(async (query) => {
  if (query === "quotes_pending") {
    return {
      data: {
        quotes: [
          {
            quoteNumber: "Q123",
            customerEmail: "nour@example.com",
            vehicleYear: 2024,
            vehicleMake: "Tesla",
            vehicleModel: "Model Y",
            grandTotal: 1200,
          },
        ],
      },
    };
  }
  return { data: null };
});

vi.mock("@/lib/nickstire/query", () => ({
  queryNick: mockQueryNick,
  queryNickBatch: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: vi.fn(),
}));

vi.mock("@/lib/services/email", () => ({
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/demo-store", () => ({
  getDemoState: vi.fn(() => ({})),
}));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));

// Mock rule dependencies so they don't hit the real DB or bridge
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: {
    remember: vi.fn(),
  },
}));

// We only want to run a specific mock rule or control triggers
// to verify lock behavior.
import { runAutonomousActions } from "@/lib/brain/autonomous-engine";

const prismaStub = {
  autonomousAction: mocks.autonomousAction,
  brainMemory: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
  },
  commitment: { findMany: vi.fn().mockResolvedValue([]) },
  task: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  $transaction: vi.fn(),
};

describe("autonomous engine lock-first-then-fire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.autonomousAction.groupBy.mockResolvedValue([]);
    vi.stubGlobal("prisma", prismaStub);
  });

  it("checks lock first and executes action only if lock is acquired (created = true)", async () => {
    // 2. Mock findFirst for cooldown check -> returns null (not recently run)
    mocks.autonomousAction.findFirst.mockResolvedValue(null);

    // 3. Mock idempotentCreate -> returns created=true (lock acquired)
    mocks.idempotentCreate.mockResolvedValue({
      created: true,
      row: { id: "action-1" },
    });

    // 4. Mock the action updates
    mocks.autonomousAction.update.mockResolvedValue({});

    await runAutonomousActions();

    expect(mocks.idempotentCreate).toHaveBeenCalled();
    expect(mocks.autonomousAction.update).toHaveBeenCalled();
  });

  it("skips action execution if lock is not acquired (created = false)", async () => {
    // Mock findFirst for cooldown check -> returns null (not recently run)
    mocks.autonomousAction.findFirst.mockResolvedValue(null);

    // Mock idempotentCreate -> returns created=false (already locked by another worker)
    mocks.idempotentCreate.mockResolvedValue({
      created: false,
      row: { id: "action-1" },
    });

    await runAutonomousActions();

    expect(mocks.idempotentCreate).toHaveBeenCalled();
    // Should NOT call update (meaning it skipped execution)
    expect(mocks.autonomousAction.update).not.toHaveBeenCalled();
  });
});
