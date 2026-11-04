/**
 * R3 round 1, item 12: the four Promises procedures on the operator router, called through the real
 * router (zod edge included) against a mocked store. A deadline must be a real calendar day: 2026-13-01
 * used to pass the regex and render "due undefined 1". The pulse cache is invalidated only when a
 * promise actually closed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "@/lib/trpc/root";

const { db, invalidate } = vi.hoisted(() => ({
  db: {
    commitment: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    task: { findMany: vi.fn(), findFirst: vi.fn() },
  },
  invalidate: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/utils/cache", async (orig) => ({ ...(await orig<object>()), invalidate: (...a: unknown[]) => invalidate(...a) }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitCommitmentTransition: vi.fn(async () => {}) }));
vi.mock("@/lib/services/commitment-conditions", () => ({ captureCommitmentConditions: vi.fn(async () => {}) }));

let caller: ReturnType<typeof appRouter.createCaller>;
beforeEach(() => {
  vi.clearAllMocks();
  caller = appRouter.createCaller({ session: { id: "operator-1", email: "operator@statenour.local", role: "operator" }, db: db as never });
});

describe("operator.promises*", () => {
  it("promisesList returns the list shape from the store", async () => {
    db.commitment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    db.commitment.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3);
    await expect(caller.operator.promisesList()).resolves.toEqual({ active: [], proposed: [], activeCount: 0, proposedCount: 3 });
  });

  it("promiseEdit refuses id 0, a 2001-character promise and an impossible date", async () => {
    await expect(caller.operator.promiseEdit({ id: 0, description: "x" })).rejects.toThrow();
    await expect(caller.operator.promiseEdit({ id: 1, description: "x".repeat(2001) })).rejects.toThrow();
    for (const deadline of ["2026-13-01", "2026-02-30", "2026-11-3"]) {
      await expect(caller.operator.promiseEdit({ id: 1, deadline }), deadline).rejects.toThrow();
    }
    expect(db.commitment.updateMany).not.toHaveBeenCalled();
  });

  it("promiseEdit takes a real date and a cleared one", async () => {
    db.commitment.updateMany.mockResolvedValue({ count: 1 });
    await expect(caller.operator.promiseEdit({ id: 1, deadline: "2028-02-29" })).resolves.toEqual({ ok: true });
    await expect(caller.operator.promiseEdit({ id: 1, deadline: null })).resolves.toEqual({ ok: true });
  });

  it("promiseResolve invalidates the pulse cache only when a promise closed", async () => {
    db.commitment.findFirst.mockResolvedValue({ status: "active" });
    db.commitment.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(caller.operator.promiseResolve({ id: 3, action: "done" })).resolves.toEqual({ resolved: true });
    expect(invalidate).toHaveBeenCalledWith("ultron_personal_pulse_v3");
    invalidate.mockClear();
    db.commitment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(caller.operator.promiseResolve({ id: 3, action: "drop" })).resolves.toEqual({ resolved: false });
    expect(invalidate).not.toHaveBeenCalled();
    await expect(caller.operator.promiseResolve({ id: 0, action: "done" })).rejects.toThrow();
  });

  it("Codex (PR 3541) 3: a successful edit or close clears the brief and command-center caches; a no-op or failed write clears nothing", async () => {
    const keys = () => invalidate.mock.calls.map((c) => c[0]);
    db.commitment.findFirst.mockResolvedValue({ status: "active" });

    db.commitment.updateMany.mockResolvedValueOnce({ count: 1 });
    await caller.operator.promiseEdit({ id: 1, description: "Call Mash" });
    expect(keys()).toEqual(expect.arrayContaining(["dashboard_brief", "ultron_command_center_state_v1"]));

    invalidate.mockClear();
    db.commitment.updateMany.mockResolvedValueOnce({ count: 1 });
    await caller.operator.promiseResolve({ id: 3, action: "done" });
    expect(keys()).toEqual(expect.arrayContaining(["dashboard_brief", "ultron_command_center_state_v1", "ultron_personal_pulse_v3"]));

    invalidate.mockClear();
    db.commitment.updateMany.mockResolvedValueOnce({ count: 0 });
    await caller.operator.promiseEdit({ id: 1, description: "Call Mash" });
    db.commitment.updateMany.mockResolvedValueOnce({ count: 0 });
    await caller.operator.promiseResolve({ id: 3, action: "drop" });
    db.commitment.updateMany.mockRejectedValueOnce(new Error("db down"));
    await expect(caller.operator.promiseEdit({ id: 1, description: "Call Mash" })).rejects.toThrow();
    expect(keys()).toEqual([]);
  });

  it("promiseToTask refuses id 0 and an empty mission id", async () => {
    await expect(caller.operator.promiseToTask({ id: 0, missionId: null })).rejects.toThrow();
    await expect(caller.operator.promiseToTask({ id: 1, missionId: "" })).rejects.toThrow();
    expect(db.commitment.findFirst).not.toHaveBeenCalled();
  });
});
