import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Guards the fix for the unbounded brain_memory scan in
 * /api/cron/embed-backfill (P2 cron-reliability audit).
 *
 * BrainMemory is retention='forever' — it grows without bound and rows carry
 * large content (base64 audio), so the candidate query MUST be bounded or the
 * twice-daily cron materializes the whole table. That concern is unchanged and
 * still pinned below.
 *
 * REWRITTEN 2026-08-16. The original asserted the IMPLEMENTATION —
 * `findMany({ orderBy: { confidence: "desc" }, take, where: { confidence: { gte: 0.2 } } })`
 * — and one of its assertions pinned the defect itself. That shape is a FIXED
 * WINDOW, not a queue: measured on prod, the window's floor was confidence 1.0
 * with 9,490 rows at the ceiling, so `take` never descended past it and 6,182
 * rows could not be selected at any cadence. 83.5% of the brain had no embedding
 * while this file stayed green, because "bounded" was the only thing it checked.
 *
 * These tests now pin the INVARIANT — the scan is bounded AND it can actually
 * reach every unembedded row — rather than the mechanism that satisfied one half
 * of it.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    // The brain_memory candidate query is raw SQL now: an anti-join cannot be
    // expressed as a Prisma findMany, and expressing it in JS is what produced
    // the fixed window.
    $queryRaw: vi.fn(),
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
  // Tagged-template call: (strings, ...values). Returns [] for the candidate
  // query and a count row for the `remaining` query; both are shaped as arrays.
  mockPrisma.$queryRaw.mockResolvedValue([{ n: 0n }]);
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
  it("bounds the brain_memory candidate query (no unbounded scan)", async () => {
    await invoke();
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    const sql = (mockPrisma.$queryRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql, "candidate query must carry a LIMIT").toMatch(/LIMIT/i);
  });

  it("selects by ACTUAL missing-ness, not a confidence window", async () => {
    await invoke();
    const sql = (mockPrisma.$queryRaw.mock.calls[0][0] as string[]).join("?");
    // The anti-join is the whole fix: rows drop out as they get embedded, so
    // the query always advances instead of re-serving the same top-N forever.
    expect(sql).toMatch(/NOT EXISTS/i);
    expect(sql).toMatch(/vector_embeddings/i);
  });

  it("excludes telemetry categories from the semantic index", async () => {
    await invoke();
    const values = mockPrisma.$queryRaw.mock.calls[0].slice(1);
    const flat = values.flat().flat();
    expect(flat, "the telemetry denylist must reach the query").toContain(
      "mastery_xp_event",
    );
  });

  it("still keeps the greene_law block bounded with a take cap", async () => {
    await invoke();
    expect(mockPrisma.brainMemory.findMany).toHaveBeenCalled();
    const arg = mockPrisma.brainMemory.findMany.mock.calls[0][0];
    expect(arg.take).toBeTypeOf("number");
    expect(arg.take).toBeGreaterThan(0);
    expect(arg.take).toBeLessThanOrEqual(500);
  });

  it("still backfills genuinely-missing rows", async () => {
    const { storeGenericEmbedding } = await import("@/lib/brain/embedding-utils");
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: "m1", category: "goal", key: "k", content: "c" },
    ]);
    await invoke();
    expect(storeGenericEmbedding).toHaveBeenCalledWith("brain_memory", "m1", expect.any(String));
  });
});
