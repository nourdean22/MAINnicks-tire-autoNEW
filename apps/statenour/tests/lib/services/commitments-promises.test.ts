/**
 * R3 · 2026-11-03 · the Promises section's one server path (lib/services/commitments.ts).
 * Nour could not list, edit or close an active commitment anywhere. These pin: the list
 * carries active + proposed with real totals and ET ages; every write is soft-delete aware
 * and stamps updatedBy "nour" (the kill read counts those rows); Done/Drop write the
 * existing vocabulary (completed / abandoned); Make it a task claims executionRef before it
 * creates, so a second tap returns the same task and a racing tap creates nothing.
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
  createTaskFromAPI: vi.fn(),
  today: vi.fn(() => "2026-11-03"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
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
vi.mock("@/lib/utils/datetime", () => ({ today: () => h.today() }));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn() }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitCommitmentTransition: vi.fn(async () => {}) }));
vi.mock("@/lib/services/commitment-conditions", () => ({ captureCommitmentConditions: vi.fn(async () => {}) }));
vi.mock("@/lib/services/task-actions", () => ({ createTaskFromAPI: (...a: unknown[]) => h.createTaskFromAPI(...a) }));

import {
  listPromises,
  editPromise,
  resolvePromise,
  promiseToTask,
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

beforeEach(() => {
  for (const f of [h.findMany, h.count, h.findFirst, h.findUnique, h.updateMany, h.taskFindMany, h.taskFindFirst, h.createTaskFromAPI]) {
    f.mockReset();
  }
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

  it("joins the linked task through executionRef task:<id>", async () => {
    h.findMany.mockResolvedValueOnce([row({ executionRef: "task:t1" })]).mockResolvedValueOnce([]);
    h.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    h.taskFindMany.mockResolvedValueOnce([{ id: "t1", status: "DONE" }]);
    const out = await listPromises();
    expect(out.active[0].task).toEqual({ id: "t1", status: "DONE" });
  });

  it("a failed read throws (the client renders unknown, never an empty list)", async () => {
    h.findMany.mockRejectedValueOnce(new Error("db down"));
    h.count.mockResolvedValue(0);
    await expect(listPromises()).rejects.toThrow("db down");
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
  it("claims executionRef before creating, then links task:<id>; status stays active", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "Send Mash the alignment quote", executionRef: null });
    h.updateMany.mockResolvedValue({ count: 1 });
    h.createTaskFromAPI.mockResolvedValueOnce({ id: "t9" });

    const out = await promiseToTask(7, null);

    expect(out).toEqual({ taskId: "t9", created: true });
    const [claim, link] = h.updateMany.mock.calls.map((c) => c[0]);
    // the claim is a compare-and-swap on the exact ref it read
    expect(claim.where).toEqual({ id: 7, status: "active", deletedAt: null, executionRef: null });
    expect(String(claim.data.executionRef)).toMatch(/^task:pending:\d+$/);
    expect(claim.data.updatedBy).toBe("nour");
    expect(h.updateMany.mock.invocationCallOrder[0]).toBeLessThan(h.createTaskFromAPI.mock.invocationCallOrder[0]);
    expect(link.where).toEqual({ id: 7, executionRef: claim.data.executionRef });
    expect(link.data).toEqual({ executionRef: "task:t9", updatedBy: "nour" });
    expect(link.data).not.toHaveProperty("status");
    expect(h.createTaskFromAPI.mock.calls[0][0]).toMatchObject({ title: "Send Mash the alignment quote", status: "INBOX" });
    expect(h.createTaskFromAPI.mock.calls[0][0]).not.toHaveProperty("missionId");
  });

  it("a second tap returns the same task and creates nothing", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: "task:t9" });
    h.taskFindFirst.mockResolvedValueOnce({ id: "t9" });
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: "t9", created: false });
    expect(h.createTaskFromAPI).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("a racing tap that loses the claim creates nothing and reports the winner's task", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: null });
    h.updateMany.mockResolvedValueOnce({ count: 0 });
    h.findUnique.mockResolvedValueOnce({ executionRef: "task:t9" });
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: "t9", created: false });
    expect(h.createTaskFromAPI).not.toHaveBeenCalled();
  });

  it("a fresh in-flight claim blocks a second create", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: `task:pending:${Date.now()}` });
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: null, reason: "in_flight" });
    expect(h.createTaskFromAPI).not.toHaveBeenCalled();
  });

  it("files into the chosen mission as READY", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: null });
    h.updateMany.mockResolvedValue({ count: 1 });
    h.createTaskFromAPI.mockResolvedValueOnce({ id: "t2" });
    await promiseToTask(7, "m1");
    expect(h.createTaskFromAPI.mock.calls[0][0]).toMatchObject({ missionId: "m1", status: "READY" });
  });

  it("a failed create releases the claim back to the ref it read, and rethrows", async () => {
    h.findFirst.mockResolvedValueOnce({ description: "x", executionRef: null });
    h.updateMany.mockResolvedValue({ count: 1 });
    h.createTaskFromAPI.mockRejectedValueOnce(new Error("mission gone"));
    await expect(promiseToTask(7, "m1")).rejects.toThrow("mission gone");
    const release = h.updateMany.mock.calls[1][0];
    expect(release.data).toEqual({ executionRef: null });
    expect(String(release.where.executionRef)).toMatch(/^task:pending:/);
  });

  it("refuses a promise that is no longer active", async () => {
    h.findFirst.mockResolvedValueOnce(null);
    await expect(promiseToTask(7, null)).resolves.toEqual({ taskId: null, reason: "not_active" });
    expect(h.findFirst.mock.calls[0][0].where).toEqual({ id: 7, status: "active", deletedAt: null });
  });
});
