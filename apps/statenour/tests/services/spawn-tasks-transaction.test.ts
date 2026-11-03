/**
 * Round 1 P1-5 / P1-10 (manager, 2026-11-03): spawnProjectTasks writes every task and the plan's task ids in ONE
 * transaction, so a failure part-way saves nothing (a partial spawn used to report 0 and a retry duplicated the
 * tasks already made). A spawned task carries no goalId of its own unless the caller passes one: it serves its
 * mission's goal through the mission (goalTaskWhere / taskGoalServer), so re-linking the mission moves it too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  missionFind: vi.fn(),
  missionUpdate: vi.fn(),
  taskFind: vi.fn(),
  createTask: vi.fn(),
  txCalls: 0,
  sync: vi.fn(),
  /** Rollback-aware store: a create inside a transaction is pending until the callback returns. */
  committed: [] as string[],
  failSecond: false,
  log: [] as string[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: { findUnique: h.missionFind, update: h.missionUpdate },
    task: { findUnique: h.taskFind },
    $transaction: async (fn: (tx: unknown) => unknown) => {
      h.txCalls++;
      const pending: string[] = [];
      const out = await fn({ mission: { findUnique: h.missionFind, update: h.missionUpdate }, task: { findUnique: h.taskFind }, pending });
      h.committed.push(...pending); // a throw above discards `pending`: the rollback
      h.log.push("commit");
      return out;
    },
  },
}));
vi.mock("@/lib/services/tasks", () => ({ createTask: h.createTask, scheduleGlobalPrioritySync: h.sync }));
vi.mock("@/lib/brain/task-events", () => ({ emitTaskEventAsync: vi.fn() }));

import { spawnProjectTasks } from "@/lib/services/spawn-tasks";

const PLAN = {
  v: 1,
  createdAt: "2026-11-03T12:00:00Z",
  updatedAt: "2026-11-03T12:00:00Z",
  title: "Run a 10k",
  phases: [{ name: "Base miles", milestone: "Base miles", steps: [{ title: "Buy shoes" }, { title: "Run 3 km" }] }],
};

beforeEach(() => {
  h.missionFind.mockReset().mockResolvedValue({ id: "m1", planData: PLAN, lifeGoalId: "g1" });
  h.missionUpdate.mockReset().mockResolvedValue({});
  h.taskFind.mockReset().mockResolvedValue(null);
  h.createTask.mockReset();
  h.sync.mockReset();
  h.txCalls = 0;
  h.committed = [];
  h.log = [];
  // A create joins the tx it is handed (pending until commit); without one it commits on the spot, as the
  // pre-transaction code (3378eaafcf) did. It queues its post-create work on afterCommit like the real createTask.
  h.createTask.mockImplementation(async (input: { title: string }, tx?: { pending: string[] }, afterCommit?: Array<() => void>) => {
    if (input.title === "Run 3 km" && h.failSecond) throw new Error("db down");
    const id = input.title === "Buy shoes" ? "t1" : "t2";
    if (tx) tx.pending.push(id);
    else h.committed.push(id);
    afterCommit?.push(() => h.log.push(`effect:${id}`));
    return { id };
  });
  h.failSecond = false;
});

describe("spawnProjectTasks", () => {
  it("creates every task and saves the task ids inside one transaction (createTask gets the tx client)", async () => {
    const r = await spawnProjectTasks({ missionId: "m1", phaseIndex: 0 });

    expect(h.txCalls).toBe(1);
    expect(h.createTask).toHaveBeenCalledTimes(2);
    for (const call of h.createTask.mock.calls) expect(call[1]).toBeDefined(); // the transaction client
    expect(r).toMatchObject({ spawned: 2, taskIds: ["t1", "t2"] });
    expect(h.missionUpdate.mock.calls[0][0].data.planData.phases[0].steps.map((s: { taskId: string }) => s.taskId)).toEqual(["t1", "t2"]);
    expect(h.sync).toHaveBeenCalledTimes(1); // the global re-score runs once, after the commit
  });

  it("a failure on the second task rolls the first back: zero tasks committed, no plan write, no post-create work", async () => {
    h.failSecond = true;

    await expect(spawnProjectTasks({ missionId: "m1", phaseIndex: 0 })).rejects.toThrow("db down");
    expect(h.committed).toEqual([]); // t1 was created inside the transaction that failed
    expect(h.missionUpdate).not.toHaveBeenCalled();
    expect(h.log.filter((l) => l.startsWith("effect:"))).toEqual([]);
  });

  it("round 2: each task's post-create work (event, audit, enrich) runs only AFTER the commit", async () => {
    await spawnProjectTasks({ missionId: "m1", phaseIndex: 0 });
    expect(h.log).toEqual(["commit", "effect:t1", "effect:t2"]);
  });

  it("a spawned task carries no goalId unless the caller passes one (round 1 P1-10)", async () => {
    await spawnProjectTasks({ missionId: "m1", phaseIndex: 0 });
    expect(h.createTask.mock.calls.every((c) => (c[0] as { goalId: unknown }).goalId === null)).toBe(true);
    h.createTask.mockClear();
    h.missionFind.mockResolvedValue({ id: "m1", planData: PLAN, lifeGoalId: "g1" });
    await spawnProjectTasks({ missionId: "m1", phaseIndex: 0, goalId: "g9" });
    expect(h.createTask.mock.calls.every((c) => (c[0] as { goalId: unknown }).goalId === "g9")).toBe(true);
  });
});
