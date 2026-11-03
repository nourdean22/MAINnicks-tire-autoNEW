/**
 * W8a item 1 (audit A1): Nick's completeTask wrote status DONE directly, so a chat completion never
 * reached checkTask's hooks (phase spawn, inherited-goal lift, cascade, outcome bridge). It routes
 * through checkTask now; this pins that the direct write is gone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  checkTask: vi.fn(),
  task: { findUnique: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: { task: h.task, lifeGoal: { findFirst: vi.fn() } } }));
vi.mock("@/lib/services/task-actions", () => ({ checkTask: h.checkTask }));
vi.mock("@/lib/services/tasks", () => ({ createTaskAndEnrich: vi.fn(), liftGoalOnTaskComplete: vi.fn() }));

import { tasksTools } from "@/lib/ai/tools/tasks";

type Exec = (a: unknown, o: unknown) => Promise<Record<string, unknown>>;
const complete = (args: unknown) => (tasksTools.completeTask.execute as unknown as Exec)(args, {});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Nick's completeTask", () => {
  it("completes a ONCE task through checkTask and never writes DONE itself", async () => {
    h.task.findUnique.mockResolvedValue({ id: "t-1", loopKind: "ONCE", status: "READY", streakCount: 0, lastCompletedAt: null, goalId: null });
    h.checkTask.mockResolvedValue({ ok: true, task: { id: "t-1", status: "DONE" }, nextPhaseSpawned: 2 });

    const r = await complete({ taskId: "t-1" });

    expect(h.checkTask).toHaveBeenCalledWith(expect.objectContaining({ id: "t-1", action: "complete", eventSource: "nick:completeTask" }));
    expect(h.task.update).not.toHaveBeenCalled();
    expect(r).toMatchObject({ completed: true, taskId: "t-1", loopKind: "ONCE", nextPhaseSpawned: 2 });
  });

  it("a DAILY task goes through the same path and keeps its streak answer", async () => {
    h.task.findUnique.mockResolvedValue({ id: "t-2", loopKind: "DAILY", status: "READY", streakCount: 3, lastCompletedAt: null, goalId: null });
    h.checkTask.mockResolvedValue({ ok: true, streakCount: 4, task: { id: "t-2" } });

    const r = await complete({ taskId: "t-2" });

    expect(h.checkTask).toHaveBeenCalledWith(expect.objectContaining({ id: "t-2", action: "complete" }));
    expect(h.task.update).not.toHaveBeenCalled();
    expect(r).toMatchObject({ completed: true, loopKind: "DAILY", streakCount: 4 });
  });

  it("an idempotent same-day DAILY check-off says so", async () => {
    h.task.findUnique.mockResolvedValue({ id: "t-2", loopKind: "DAILY", status: "READY", streakCount: 3, lastCompletedAt: new Date(), goalId: null });
    h.checkTask.mockResolvedValue({ ok: true, idempotent: true, streakCount: 3, lastCompletedAt: new Date() });

    const r = await complete({ taskId: "t-2" });

    expect(r).toMatchObject({ completed: true, idempotent: true, streakCount: 3 });
  });

  it("an unknown id is an error, not a call", async () => {
    h.task.findUnique.mockResolvedValue(null);
    const r = await complete({ taskId: "nope" });
    expect(r).toEqual({ completed: false, error: "task not found" });
    expect(h.checkTask).not.toHaveBeenCalled();
  });
});
