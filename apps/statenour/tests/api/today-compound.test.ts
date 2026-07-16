/**
 * tests/api/today-compound.test.ts · missions-mediums wave · 2026-07-16.
 *
 * Locks the "done today" definition for GET /api/tasks/today-compound:
 * tasksDone + focusedMinutes must filter on `lastCompletedAt` (set by
 * every completion path), NOT `updatedAt` — updatedAt counted any DONE
 * row merely touched today (retro sweeps, metadata edits) as done today.
 *
 * Mocks prisma + auth-guard · no real DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  masteryScore: { findMany: vi.fn() },
  brainMemory: { count: vi.fn(), findMany: vi.fn() },
  goalEvent: { groupBy: vi.fn() },
  task: { findMany: vi.fn(), count: vi.fn() },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn(() => 0),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    masteryScore: mocks.masteryScore,
    brainMemory: mocks.brainMemory,
    goalEvent: mocks.goalEvent,
    task: mocks.task,
  },
  resetQueryCount: mocks.resetQueryCount,
  getQueryCount: mocks.getQueryCount,
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSession: vi.fn(async () => ({ id: "operator-1" })),
  requireCronAuth: vi.fn(),
  requireSyncAuth: vi.fn(),
}));

import { GET } from "@/app/api/tasks/today-compound/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.masteryScore.findMany.mockResolvedValue([]);
  mocks.brainMemory.count.mockResolvedValue(0);
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.goalEvent.groupBy.mockResolvedValue([]);
  mocks.task.findMany.mockResolvedValue([
    { actualMinutes: 25 },
    { actualMinutes: 15 },
  ]);
  mocks.task.count.mockResolvedValue(4);
});

describe("GET /api/tasks/today-compound · done-today filter", () => {
  it("filters today's DONE tasks on lastCompletedAt, not updatedAt", async () => {
    const req = new Request("http://localhost/api/tasks/today-compound");
    const res = (await GET(req as never, { params: Promise.resolve({}) } as never)) as Response;
    expect(res.status).toBe(200);

    expect(mocks.task.findMany).toHaveBeenCalledTimes(1);
    const where = mocks.task.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("DONE");
    expect(where.deletedAt).toBeNull();
    expect(where.updatedAt).toBeUndefined();
    expect(where.lastCompletedAt).toBeDefined();
    expect(where.lastCompletedAt.gte).toBeInstanceOf(Date);
    expect(where.lastCompletedAt.lte).toBeInstanceOf(Date);
    // The bound is a real day window (start strictly before end).
    expect(where.lastCompletedAt.gte.getTime()).toBeLessThan(
      where.lastCompletedAt.lte.getTime(),
    );
  });

  it("sums focusedMinutes and tasksDone from the lastCompletedAt-scoped rows", async () => {
    const req = new Request("http://localhost/api/tasks/today-compound");
    const res = (await GET(req as never, { params: Promise.resolve({}) } as never)) as Response;
    const json = (await res.json()) as {
      data?: { focusedMinutes: number; tasksDone: number };
      focusedMinutes?: number;
      tasksDone?: number;
    };
    const payload = json.data ?? json;
    expect(payload.focusedMinutes).toBe(40);
    expect(payload.tasksDone).toBe(2);
  });
});
