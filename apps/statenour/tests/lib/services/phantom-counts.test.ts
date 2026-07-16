/**
 * tests/lib/services/phantom-counts.test.ts · 2026-07-16.
 *
 * Soft-deleted rows are tombstones. Counting them makes a number a lie.
 *
 * Live prod at the time of this fix: 104 of 161 Task rows and 6,319 of 17,926
 * BrainMemory rows were soft-deleted. GET /api/health reported 161 tasks and
 * an INBOX backlog of 52 when the true live universe was 57 and **zero** —
 * i.e. the operator's entire inbox backlog was fictional, and Nick's health
 * governor reasoned over ~104 tasks that do not exist.
 *
 * These lock the WHERE clauses of the surfaces that report those numbers to
 * the operator or state them to Nick as fact. Asserting on the query args (not
 * a live DB) is the point: the defect was a missing filter, so the filter is
 * exactly what must be pinned.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
  commitment: { count: vi.fn() },
  reflection: { count: vi.fn() },
  brainMemory: { count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  auditEvent: { findFirst: vi.fn(), findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    commitment: mocks.commitment,
    reflection: mocks.reflection,
    brainMemory: mocks.brainMemory,
    auditEvent: mocks.auditEvent,
    $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
  },
}));

vi.mock("@/lib/mastery/drift-engine", () => ({
  getUnresolvedAlerts: vi.fn(async () => []),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.task.count.mockResolvedValue(0);
  mocks.task.groupBy.mockResolvedValue([]);
  mocks.commitment.count.mockResolvedValue(0);
  mocks.reflection.count.mockResolvedValue(0);
  mocks.brainMemory.count.mockResolvedValue(0);
  mocks.brainMemory.groupBy.mockResolvedValue([]);
  mocks.brainMemory.aggregate.mockResolvedValue({ _avg: { confidence: 0 } });
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.auditEvent.findFirst.mockResolvedValue(null);
  mocks.auditEvent.findMany.mockResolvedValue([]);
});

describe("God-Mode system actions · brain stats exclude tombstones", () => {
  it("systemHealth counts only live brain memories", async () => {
    const { handleSystemHealth } = await import("@/lib/ai/agent-actions/system-actions");

    await handleSystemHealth({} as never, "system.health");

    expect(mocks.brainMemory.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it("brainStats filters count, groupBy AND the confidence average", async () => {
    const { handleSystemBrainStats } = await import("@/lib/ai/agent-actions/system-actions");

    await handleSystemBrainStats({} as never, "system.brain-stats");

    expect(mocks.brainMemory.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
    expect(mocks.brainMemory.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
    // The pruner soft-deletes LOW-confidence rows, so an unfiltered average is
    // dragged down by memories Nick has already decided he no longer holds.
    expect(mocks.brainMemory.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });
});

describe("buildPageData · brain grounding excludes tombstones", () => {
  it("the 'N memories touched this week' line Nick is told counts live rows only", async () => {
    const { buildPageData } = await import("@/lib/ai/page-data");

    await buildPageData("brain");

    const countArgs = mocks.brainMemory.count.mock.calls[0][0];
    expect(countArgs.where).toMatchObject({ deletedAt: null });
    const groupArgs = mocks.brainMemory.groupBy.mock.calls[0][0];
    expect(groupArgs.where).toMatchObject({ deletedAt: null });
  });
});

// NOTE: lib/mastery/drift-engine.ts (the NOVELTY-SEEKING gate) is deliberately
// NOT tested here — this file has to mock that module for getUnresolvedAlerts,
// which would shadow the very function under test. Its filter is pinned by
// scripts/audit-soft-delete-filters.ts instead (a static guard can't be fooled
// by a mock).
