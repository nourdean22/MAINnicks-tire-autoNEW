/**
 * tests/lib/services/task-actions-uncheck.test.ts · 2026-11-03
 *
 * "uncheck" on the one check spine. checkTask coerced every action that was
 * not the literal "break" into "complete" (task-actions.ts, 2026-08-23
 * comment), so an "uncheck" from any caller used to mark the habit DONE
 * again. It now goes to uncheckDailyCompletion, the same function the chat's
 * uncheckTask writes through, and the tRPC edge accepts it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  uncheckDailyCompletion: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { task: mocks.task, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ task: mocks.task })) },
}));
vi.mock("@/lib/services/daily-backfill", () => ({ uncheckDailyCompletion: mocks.uncheckDailyCompletion }));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn(), logUpdate: vi.fn(), stripNoise: vi.fn((x) => x) }));
vi.mock("@/lib/cache/dashboard-cache", () => ({ invalidateMutationCaches: vi.fn() }));
vi.mock("@/lib/brain/task-events", () => ({ emitTaskEventAsync: vi.fn(), emitTaskCompleted: vi.fn() }));
vi.mock("@/lib/services/auto-learn", () => ({ runAutoLearn: vi.fn(async () => null) }));
vi.mock("@/lib/services/skill-reinforce", () => ({ reinforceSkill: vi.fn(async () => undefined), matchSkillKeys: vi.fn(() => []) }));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordOutcomeByContent: vi.fn(async () => true) }));

import { checkTask } from "@/lib/services/task-actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkTask · action uncheck", () => {
  it("routes to uncheckDailyCompletion and never touches the completion path", async () => {
    const at = new Date("2026-11-02T17:00:00.000Z");
    mocks.uncheckDailyCompletion.mockResolvedValue({
      ok: true,
      taskId: "h1",
      date: "2026-11-03",
      changed: true,
      streakCount: 4,
      lastCompletedAt: at,
    });
    const r = await checkTask({ id: "h1", action: "uncheck", eventSource: "missions-page" });
    expect(mocks.uncheckDailyCompletion).toHaveBeenCalledWith({ id: "h1", source: "missions-page" });
    expect(mocks.task.findUnique).not.toHaveBeenCalled();
    expect(mocks.task.update).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, unchecked: true, streakCount: 4, lastCompletedAt: at });
    expect(r.reward).toBeUndefined();
  });

  it("a day with nothing to take back reports unchecked:false", async () => {
    mocks.uncheckDailyCompletion.mockResolvedValue({
      ok: true,
      taskId: "h1",
      date: "2026-11-03",
      changed: false,
      streakCount: 2,
      lastCompletedAt: null,
    });
    const r = await checkTask({ id: "h1", action: "uncheck" });
    expect(r.unchecked).toBe(false);
    expect(mocks.uncheckDailyCompletion).toHaveBeenCalledWith({ id: "h1", source: "service:checkTask" });
  });
});

describe("task.check input · the tRPC edge accepts uncheck", () => {
  it("z.enum carries complete, break and uncheck", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../../lib/trpc/routers/task.ts", import.meta.url), "utf8"),
    );
    // Source read on purpose: the router module pulls the whole tRPC context; the enum is the contract.
    expect(src).toMatch(/action: z\.enum\(\["complete", "break", "uncheck"\]\)\.optional\(\)/);
  });
});
