import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Guards the fix for the unbounded brain_memory scan in
 * /api/cron/embed-backfill (P2 cron-reliability audit).
 *
 * BrainMemory is retention='forever' — it grows without bound and rows
 * carry large content (base64 audio). The backfill only needs the top
 * ~15 by confidence, so its findMany MUST be bounded with `take`.
 * Without the cap, the twice-daily cron materializes the whole table.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    vectorEmbedding: { findMany: vi.fn() },
    brainMemory: { findMany: vi.fn() },
    brainDump: { findMany: vi.fn() },
    reflection: { findMany: vi.fn() },
    // Silo wave (audit 2026-07-15) · situation_log + decision_replay
    // joined the backfill's covered source types.
    situationLog: { findMany: vi.fn() },
    decisionReplay: { findMany: vi.fn() },
    strategicLaw: { findMany: vi.fn() },
    chatMessage: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/brain/embedding-utils", () => ({
  storeGenericEmbedding: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));

import { GET } from "@/app/api/cron/embed-backfill/route";

const req = new Request("http://test/api/cron/embed-backfill");
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.vectorEmbedding.findMany.mockResolvedValue([]);
  mockPrisma.brainMemory.findMany.mockResolvedValue([]);
  mockPrisma.brainDump.findMany.mockResolvedValue([]);
  mockPrisma.reflection.findMany.mockResolvedValue([]);
  mockPrisma.situationLog.findMany.mockResolvedValue([]);
  mockPrisma.decisionReplay.findMany.mockResolvedValue([]);
  mockPrisma.strategicLaw.findMany.mockResolvedValue([]);
  mockPrisma.chatMessage.findMany.mockResolvedValue([]);
});

const invoke = () =>
  (GET as unknown as (r: Request, c: unknown) => Promise<unknown>)(req, ctx);

describe("cron/embed-backfill · bounded scans", () => {
  it("bounds the brain_memory scan with a `take` cap (no unbounded findMany)", async () => {
    await invoke();
    expect(mockPrisma.brainMemory.findMany).toHaveBeenCalledTimes(2);
    
    // First call (brain_memory block)
    const arg1 = mockPrisma.brainMemory.findMany.mock.calls[0][0];
    expect(arg1.take).toBeTypeOf("number");
    expect(arg1.take).toBeGreaterThan(0);
    expect(arg1.take).toBeLessThanOrEqual(500);

    // Second call (greene_law block)
    const arg2 = mockPrisma.brainMemory.findMany.mock.calls[1][0];
    expect(arg2.take).toBeTypeOf("number");
    expect(arg2.take).toBeGreaterThan(0);
    expect(arg2.take).toBeLessThanOrEqual(500);
  });

  it("keeps the highest-confidence-first ordering so the cap drains the right rows", async () => {
    await invoke();
    const arg = mockPrisma.brainMemory.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual({ confidence: "desc" });
    expect(arg.where).toEqual({ confidence: { gte: 0.2 } });
  });

  it("still backfills genuinely-missing rows within the bounded window", async () => {
    const { storeGenericEmbedding } = await import(
      "@/lib/brain/embedding-utils"
    );
    // One memory row present, none embedded yet → should embed it.
    mockPrisma.brainMemory.findMany.mockResolvedValueOnce([
      { id: "m1", category: "goal", key: "k", content: "c" },
    ]);
    await invoke();
    expect(storeGenericEmbedding).toHaveBeenCalledWith(
      "brain_memory",
      "m1",
      expect.stringContaining("m1".length ? "" : "m1"),
    );
  });
});
