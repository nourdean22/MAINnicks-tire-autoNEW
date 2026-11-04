/**
 * R3 · 2026-11-03 · the Promises section's one server path (lib/services/commitments.ts).
 * Nour could not list, edit or close an active commitment anywhere. These pin: the list
 * carries active + proposed with real totals and ET ages; every write is soft-delete aware
 * and stamps updatedBy "nour" (the kill read counts those rows); Done/Drop write the
 * existing vocabulary (completed / abandoned); Make it a task claims executionRef before it
 * creates, makes the task and its link in one transaction, so a second tap returns the same
 * task, a racing tap creates nothing and a failed link leaves no task behind.
 *
 * The store mock is rollback-aware: a task created inside $transaction is committed only when
 * the callback returns. `h.committed` is every task that exists afterwards, whichever create
 * path the service takes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  taskFindMany: vi.fn(),
  taskFindFirst: vi.fn(),
  today: vi.fn(() => "2026-11-03"),
  committed: [] as string[],
  stage: null as string[] | null,
  inputs: [] as Record<string, unknown>[],
  next: 0,
  afterRan: [] as string[],
  sync: vi.fn(),
  notify: vi.fn(async () => {}),
  logError: vi.fn(),
  resolveInbox: vi.fn(async () => "m-inbox"),
  createFails: null as Error | null,
}));

function makeTask(input: Record<string, unknown>, into: string[]): { id: string } {
  if (h.createFails) throw h.createFails;
  h.inputs.push(input);
  const id = `t${++h.next}`;
  into.push(id);
  return { id };
}

// Hoisted with the mocks: vi.mock factories run before top-level consts exist.
const { db } = vi.hoisted(() => ({
  db: {
    commitment: {
      findMany: (...a: unknown[]) => h.findMany(...a),
      count: (...a: unknown[]) => h.count(...a),
      findFirst: (...a: unknown[]) => h.findFirst(...a),
      findUnique: (...a: unknown[]) => h.findUnique(...a),
      updateMany: (...a: unknown[]) => h.updateMany(...a),
    },
    task: {
      findMany: (...a: unknown[]) => h.taskFindMany(...a),
      findFirst: (...a: unknown[]) => h.taskFindFirst(...a),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...db,
    // Rollback-aware: staged task rows reach `committed` only when the callback returns.
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => {
      const staged: string[] = [];
      h.stage = staged;
      try {
        const out = await fn(db);
        h.committed.push(...staged);
        return out;
      } finally {
        h.stage = null;
      }
    },
  },
}));
vi.mock("@/lib/utils/datetime", () => ({ today: () => h.today() }));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn() }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitCommitmentTransition: vi.fn(async () => {}) }));
vi.mock("@/lib/services/commitment-conditions", () => ({ captureCommitmentConditions: vi.fn(async () => {}) }));
vi.mock("@/lib/utils/error-log", () => ({ logError: (...a: unknown[]) => h.logError(...a) }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: () => h.resolveInbox() }));
vi.mock("@/lib/services/tasks", () => ({
  createTask: async (input: Record<string, unknown>, tx: unknown, afterCommit?: Array<() => void>) => {
    if (tx && !afterCommit) throw new Error("createTask inside a transaction needs afterCommit");
    const t = makeTask(input, tx ? h.stage! : h.committed);
    afterCommit?.push(() => h.afterRan.push(t.id));
    return t;
  },
  scheduleGlobalPrioritySync: (...a: unknown[]) => h.sync(...a),
}));
vi.mock("@/lib/services/task-actions", () => ({
  createTaskFromAPI: async (input: Record<string, unknown>) => makeTask(input, h.committed),
  notifyTaskCreated: (...a: unknown[]) => h.notify(...a),
}));

import {
  listPromises,
  editPromise,
  resolvePromise,
  promiseToTask,
  closePromisesForTask,
  isCalendarDate,
  PROMISE_ACTOR,
} from "@/lib/services/commitments";

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  description: "Send Mash the alignment quote",
  toWhom: "Mash",
  deadline: null,
  dateMade: "2026-09-03",
  status: "active",
  executionRef: null,
  ...over,
});

const PENDING = /^task:pending:\d+$/;
/** The updateMany calls that set a pending claim, in order. */
const claims = () => h.updateMany.mock.calls.map((c) => c[0]).filter((a) => PENDING.test(String(a.data?.executionRef)));

beforeEach(() => {
  for (const f of [h.findMany, h.count, h.findFirst, h.findUnique, h.updateMany, h.taskFindMany, h.taskFindFirst, h.sync, h.notify, h.logError]) {
    f.mockReset();
  }
  h.committed = [];
  h.inputs = [];
  h.afterRan = [];
  h.next = 0;
  h.createFails = null;
  h.taskFindMany.mockResolvedValue([]);
  h.findUnique.mockResolvedValue(null);
});

describe("listPromises", () => {
  it("returns active and proposed rows with real totals, ET age and deadline distance", async () => {
    h.findMany
      .mockResolvedValueOnce([row(), row({ id: 2, toWhom: "self", deadline: "2026-11-01", dateMade: "2026-11-03" })])
      .mockResolvedValueOnce([row({ id: 9, status: "proposed", toWhom: "self", dateMade: "2026-10-27" })]);
    h.count.mockResolvedValueOnce(2).mockResolvedValueOnce(467);

    const out = await listPromises();

    expect(out.activeCount).toBe(2);
    expect(out.proposedCount).toBe(467);
    expect(out.active.map((r) => r.id)).toEqual([1, 2]);
    expect(out.active[0]).toMatchObject({ toWhom: "Mash", deadline: null, ageDays: 61, deadlineDays: null, task: null });
    expect(out.active[1]).toMatchObject({ ageDays: 0, deadlineDays: -2 });
    expect(out.proposed[0]).toMatchObject({ id: 9, ageDays: 7 });
    // soft-delete aware on every read
    for (const call of [...h.findMany.mock.calls, ...h.count.mock.calls]) {
      expect((call[0] as { where: { deletedAt: unknown } }).where.deletedAt).toBeNull();
    }
    expect((h.findMany.mock.calls[0][0] as { where: { status: unknown } }).where.status).toBe("active");
    expect((h.findMany.mock.calls[1][0] as { where: { status: unknown } }).where.status).toBe("proposed");
  });

  it("joins the linked task through executionRef task:<id>, live tasks only", async () => {
    h.findMany.mockResolvedValueOnce([row({ executionRef: "task:t1" })]).mockResolvedValueOnce([]);
    h.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    h.taskFindMany.mockResolvedValueOnce([{ id: "t1", status: "DONE" }]);
    const out = await listPromises();
    expect(out.active[0].task).toEqual({ id: "t1", status: "DONE" });
    expect(h.taskFindMany.mock.calls[0][0].where).toEqual({ id: { in: ["t1"] }, deletedAt: null });
  });

  it("a dateMade or deadline that is not a calendar date gives no age and no distance, never NaN", async () => {
    h.findMany
      .mockResolvedValueOnce([row({ dateMade: "Nov 2", deadline: "2026-13-01" })])
      .mockResolvedValueOnce([]);
    h.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const out = await listPromises();
    expect(out.active[0].ageDays).toBeNull();
    expect(out.active[0].deadlineDays).toBeNull();
  });

  it("a failed read throws (the client renders unknown, never an empty list)", async () => {
    h.findMany.mockRejectedValueOnce(new Error("db down"));
    h.count.mockResolvedValue(0);
    await expect(listPromises()).rejects.toThrow("db down");
  });
});

describe("isCalendarDate", () => {
  it("accepts real days and refuses impossible ones", () => {
    for (const ok of ["2026-11-03", "2028-02-29", "2026-12-31"]) expect(isCalendarDate(ok), ok).toBe(true);
    for (const bad of ["2026-13-01", "2026-02-30", "2027-02-29", "2026-00-10", "2026-11-3", "next Friday", ""]) {
      expect(isCalendarDate(bad), bad).toBe(false);
    }
  });
});

describe("editPromise", () => {
  it("writes text, to whom and deadline on an active, undeleted row, stamped nour", async () => {
    h.updateMany.mockResolvedValueOnce({ count: 1 });
    const ok = await editPromise(5, { description: " Call Mash ", toWhom: "", deadline: "2026-11-10" });
    expect(ok).toBe(true);
    const call = h.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 5, status: "active", deletedAt: null });
    expect(call.data).toEqual({ description: "Call Mash", toWhom: "self", deadline: "2026-11-10", updatedBy: "nour" });
  });

  it("clears the deadline with null and returns false when nothing matched", async () => {
    h.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(editPromise(5, { deadline: null })).resolves.toBe(false);
    expect(h.updateMany.mock.calls[0][0].data).toEqual({ deadline: null, updatedBy: "nour" });
  });
});

describe("resolvePromise", () => {
  it("Done writes completed, Drop writes abandoned, both stamped nour and active-only", async () => {
    expect(PROMISE_ACTOR).toBe("nour");
    h.updateMany.mockResolvedValue({ count: 1 });
    await expect(resolvePromise(3, "done")).resolves.toBe(true);
    await expect(resolvePromise(4, "drop")).resolves.toBe(true);
    const [done, drop] = h.updateMany.mock.calls.map((c) => c[0]);
    expect(done.where).toEqual({ id: 3, status: "active", deletedAt: null });
    expect(done.data).toMatchObject({ status: "completed", updatedBy: "nour" });
    expect(drop.where).toEqual({ id: 4, status: "active", deletedAt: null });
    expect(drop.data).toMatchObject({ status: "abandoned", updatedBy: "nour" });
  });
});

describe("promiseToTask", () => {
  it("claims executionRef before creating, makes the task and its link in one transaction; status stays active", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "Send Mash the alignment quote", executionRef: null });
    h.updateMany.mockResolvedValue({ count: 1 });

    const out = await promiseToTask(7, null);

    expect(out).toEqual({ taskId: "t1", created: true });
    expect(h.committed).toEqual(["t1"]);
    const [claim, link] = h.updateMany.mock.calls.map((c) => c[0]);
    // the claim is a compare-and-swap on the exact ref it read, with no section mark of its own
    expect(claim.where).toEqual({ id: 7, status: "active", deletedAt: null, executionRef: null });
    expect(String(claim.data.executionRef)).toMatch(PENDING);
    expect(claim.data).not.toHaveProperty("updatedBy");
    expect(link.where).toEqual({ id: 7, executionRef: claim.data.executionRef });
    expect(link.data).toEqual({ executionRef: "task:t1", updatedBy: "nour" });
    expect(link.data).not.toHaveProperty("status");
    expect(h.inputs[0]).toMatchObject({ title: "Send Mash the alignment quote", status: "INBOX", missionId: "m-inbox" });
    // post-commit work runs after the commit, then the global re-score, then the house ping to Nour
    expect(h.afterRan).toEqual(["t1"]);
    expect(h.sync).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("a second tap returns the same task and creates nothing", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: "task:t9" });
    h.taskFindFirst.mockResolvedValueOnce({ id: "t9" });
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: "t9", created: false });
    expect(h.committed).toEqual([]);
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.taskFindFirst.mock.calls[0][0].where).toEqual({ id: "t9", deletedAt: null });
  });

  it("a linked task that was deleted is replaced: claim, create, created true", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: "task:t9" });
    h.taskFindFirst.mockResolvedValueOnce(null);
    h.updateMany.mockResolvedValue({ count: 1 });
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: "t1", created: true });
    expect(claims()[0].where.executionRef).toBe("task:t9");
    expect(h.committed).toEqual(["t1"]);
  });

  it("a racing tap that loses the claim creates nothing and reports the winner's task", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: null });
    h.updateMany.mockResolvedValueOnce({ count: 0 });
    h.findUnique.mockResolvedValueOnce({ executionRef: "task:t9", status: "active", deletedAt: null });
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: "t9", created: false });
    expect(h.committed).toEqual([]);
  });

  it("a losing racer that finds a pending claim says in flight, never a task that does not exist", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: null });
    h.updateMany.mockResolvedValueOnce({ count: 0 });
    h.findUnique.mockResolvedValueOnce({ executionRef: `task:pending:${Date.now()}`, status: "active", deletedAt: null });
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: null, reason: "in_flight" });
    expect(h.committed).toEqual([]);
  });

  it("a lost swap because the promise was closed elsewhere says not active, not in flight", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: null });
    h.updateMany.mockResolvedValueOnce({ count: 0 });
    h.findUnique.mockResolvedValueOnce({ executionRef: null, status: "completed", deletedAt: null });
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: null, reason: "not_active" });
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: null });
    h.updateMany.mockResolvedValueOnce({ count: 0 });
    h.findUnique.mockResolvedValueOnce({ executionRef: null, status: "active", deletedAt: new Date() });
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: null, reason: "not_active" });
  });

  it("a fresh in-flight claim blocks a second create", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: `task:pending:${Date.now()}` });
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: null, reason: "in_flight" });
    expect(h.committed).toEqual([]);
  });

  it("a stale claim (a crashed create) is retaken: swap pinned to the old ref, one task made and linked", async () => {
    const stale = `task:pending:${Date.now() - 61_000}`;
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: stale });
    h.updateMany.mockResolvedValue({ count: 1 });
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: "t1", created: true });
    expect(claims()[0].where.executionRef).toBe(stale);
    expect(h.committed).toEqual(["t1"]);
  });

  it("two racers on the same stale claim: the loser's swap matches nothing and exactly one task is made", async () => {
    const stale = `task:pending:${Date.now() - 61_000}`;
    h.findFirst.mockResolvedValue({ description: "x", executionRef: stale });
    // racer A wins the swap and links; racer B's swap on the same stale ref then matches 0 rows
    h.updateMany
      .mockResolvedValueOnce({ count: 1 }) // A claim
      .mockResolvedValueOnce({ count: 1 }) // A link
      .mockResolvedValueOnce({ count: 0 }); // B claim
    h.findUnique.mockResolvedValueOnce({ executionRef: "task:t1", status: "active", deletedAt: null });
    const a = await promiseToTask(7, null);
    const b = await promiseToTask(7, null);
    expect(a).toEqual({ taskId: "t1", created: true });
    expect(b).toEqual({ taskId: "t1", created: false });
    expect(h.committed).toEqual(["t1"]);
    expect(claims().map((c) => c.where.executionRef)).toEqual([stale, stale]);
  });

  it("files into the chosen mission as READY", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: null });
    h.updateMany.mockResolvedValue({ count: 1 });
    await promiseToTask(7, "m1");
    expect(h.inputs[0]).toMatchObject({ missionId: "m1", status: "READY" });
  });

  it("a link write that fails rolls the task back, releases the claim, and the next tap makes exactly one task", async () => {
    h.findFirst.mockResolvedValue({ description: "x", executionRef: null });
    h.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockRejectedValueOnce(new Error("neon blip")) // link
      .mockResolvedValueOnce({ count: 1 }) // release
      .mockResolvedValue({ count: 1 }); // second tap: claim + link
    await expect(promiseToTask(7, null)).rejects.toThrow("neon blip");
    expect(h.committed).toEqual([]);
    const release = h.updateMany.mock.calls[2][0];
    expect(release.data).toEqual({ executionRef: null });
    expect(String(release.where.executionRef)).toMatch(PENDING);

    await expect(promiseToTask(7, null)).resolves.toMatchObject({ created: true });
    expect(h.committed).toHaveLength(1);
  });

  it("a link that matches no row (the claim was lost) throws and leaves no task", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: null });
    h.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 0 }) // link
      .mockResolvedValue({ count: 0 }); // release
    await expect(promiseToTask(7, null)).rejects.toThrow();
    expect(h.committed).toEqual([]);
  });

  it("a failed create releases the claim back to the ref it read, and rethrows", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: null });
    h.updateMany.mockResolvedValue({ count: 1 });
    h.createFails = new Error("mission gone");
    await expect(promiseToTask(7, "m1")).rejects.toThrow("mission gone");
    const release = h.updateMany.mock.calls[1][0];
    expect(release.data).toEqual({ executionRef: null });
    expect(String(release.where.executionRef)).toMatch(PENDING);
  });

  it("a release that also fails is logged by id and the original error is the one thrown", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "Send Mash the alignment quote", executionRef: null });
    h.updateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error("release down"));
    h.createFails = new Error("mission gone");
    await expect(promiseToTask(7, "m1")).rejects.toThrow("mission gone");
    expect(h.logError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.logError.mock.calls[0])).toContain('"id":7');
    expect(JSON.stringify(h.logError.mock.calls[0])).not.toContain("Send Mash");
  });

  it("refuses a promise that is no longer active", async () => {
    h.findFirst.mockResolvedValueOnce(null);
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: null, reason: "not_active" });
    expect(h.findFirst.mock.calls[0][0].where).toEqual({ id: 7, status: "active", deletedAt: null });
  });
});

describe("closePromisesForTask (auto-close when the task is done)", () => {
  it("completes each active promise linked to the task, pinned to the ref, stamped system:task-done", async () => {
    h.findMany.mockResolvedValueOnce([{ id: 4 }]);
    h.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(closePromisesForTask("t9")).resolves.toBe(1);
    expect(h.findMany.mock.calls[0][0].where).toEqual({ executionRef: "task:t9", status: "active", deletedAt: null });
    const call = h.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 4, executionRef: "task:t9", status: "active", deletedAt: null });
    expect(call.data).toMatchObject({ status: "completed", updatedBy: "system:task-done" });
  });

  it("a task no promise points at closes nothing", async () => {
    h.findMany.mockResolvedValueOnce([]);
    await expect(closePromisesForTask("t1")).resolves.toBe(0);
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});
