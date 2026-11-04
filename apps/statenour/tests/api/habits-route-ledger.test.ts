/**
 * tests/api/habits-route-ledger.test.ts · 2026-11-03
 *
 * GET /api/habits?date= answered "done on date" from lastCompletedAt's UTC
 * date (a 9pm ET check-off read as the next day), counted soft-deleted
 * habits, never saw a day backfilled before the latest check-off, and turned
 * a failed read into every habit not done. It now reads habitDays: the date
 * and the six days before it, per habit, off the TaskEvent ledger.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  task: { findMany: vi.fn() },
  taskEvent: { findMany: vi.fn() },
  userPreference: { findUnique: vi.fn(async () => null) },
  apiRequestLog: { create: vi.fn(async () => ({})) },
  errorLog: { create: vi.fn(async () => ({})) },
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireEvidenceAuth: vi.fn(),
  requireQueueAuth: vi.fn(),
  requireDeviceAgentAuth: vi.fn(),
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));
vi.mock("@/lib/mastery/goal-stats", () => ({ creditTaskStats: vi.fn() }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/services/tasks", () => ({ invalidateMutationCaches: vi.fn() }));

import { GET } from "@/app/api/habits/route";

const noonEst = (d: string) => new Date(`${d}T17:00:00.000Z`);
const get = async (date: string) => {
  const res = await GET(new Request(`http://localhost/api/habits?date=${date}`) as never, undefined as never);
  return { status: res.status, body: (await res.json()) as any };
};
const habit = (body: any, key: string) => (body.data ?? body).habits.find((h: { key: string }) => h.key === key);

beforeEach(() => {
  db.task.findMany.mockReset();
  db.taskEvent.findMany.mockReset();
});

describe("GET /api/habits · per-day from the ledger", () => {
  it("a day backfilled before lastCompletedAt reads done on that date, with the 7-day row beside it", async () => {
    db.task.findMany.mockResolvedValue([
      { id: "h1", title: "Journal / Daily Command", loopKind: "DAILY", streakCount: 1, lastCompletedAt: noonEst("2026-11-03") },
    ]);
    db.taskEvent.findMany.mockResolvedValue([
      { taskId: "h1", kind: "completed", createdAt: noonEst("2026-11-01"), payload: { backfilled: true } },
      { taskId: "h1", kind: "completed", createdAt: noonEst("2026-11-03"), payload: {} },
    ]);
    const { status, body } = await get("2026-11-01");
    expect(status).toBe(200);
    const j = habit(body, "journal");
    expect(j.completed).toBe(true);
    expect(j.days).toHaveLength(7);
    expect(j.days[0]).toEqual({ day: "2026-11-01", done: true });
  });

  it("a 9pm ET check-off is done on its ET day, not the next UTC day", async () => {
    // 2026-11-02 21:00 EST = 2026-11-03T02:00Z.
    const ninePm = new Date("2026-11-03T02:00:00.000Z");
    db.task.findMany.mockResolvedValue([
      { id: "h1", title: "Workout", loopKind: "DAILY", streakCount: 1, lastCompletedAt: ninePm },
    ]);
    db.taskEvent.findMany.mockResolvedValue([{ taskId: "h1", kind: "completed", createdAt: ninePm, payload: {} }]);
    expect(habit((await get("2026-11-02")).body, "workout").completed).toBe(true);
    expect(habit((await get("2026-11-03")).body, "workout").completed).toBe(false);
  });

  it("reads only live habits", async () => {
    db.task.findMany.mockResolvedValue([]);
    db.taskEvent.findMany.mockResolvedValue([]);
    await get("2026-11-03");
    expect(db.task.findMany.mock.calls[0][0].where).toMatchObject({ loopKind: "DAILY", deletedAt: null });
  });

  it("a failed LEDGER read is an error response too, never a 200 of every habit not done", async () => {
    db.task.findMany.mockResolvedValue([
      { id: "h1", title: "Workout", loopKind: "DAILY", streakCount: 2, lastCompletedAt: noonEst("2026-11-03") },
    ]);
    db.taskEvent.findMany.mockRejectedValue(new Error("db down"));
    expect((await get("2026-11-03")).status).toBeGreaterThanOrEqual(500);
  });

  it("a malformed date is a 400, not a crash", async () => {
    db.task.findMany.mockResolvedValue([]);
    expect((await get("2026-13-45")).status).toBe(400);
  });

  it("a failed read is an error response, never every habit not done", async () => {
    db.task.findMany.mockRejectedValue(new Error("db down"));
    const { status } = await get("2026-11-03");
    expect(status).toBeGreaterThanOrEqual(500);
  });
});
