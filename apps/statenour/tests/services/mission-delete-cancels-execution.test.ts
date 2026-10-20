/**
 * Deleting a mission stops its durable execution (2026-10-19, Codex P1 on PR 3181).
 *
 * updateMission cancels the run when a mission leaves ACTIVE, but the owner DELETE endpoint
 * (DELETE /api/missions/[id] -> deleteMission) soft-deleted an ACTIVE mission and left its Inngest run
 * stepping. Every test goes through the real DELETE route, so it proves the route reaches the change.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  softDelete: vi.fn(),
  softDeleteMany: vi.fn(),
  cancel: vi.fn(),
  demo: false,
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
  requireSyncAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireEvidenceAuth: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
    errorLog: { create: vi.fn().mockResolvedValue({}) },
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));
vi.mock("@/lib/runtime", () => ({
  get isDemoMode() {
    return h.demo;
  },
}));
vi.mock("@/lib/db/soft-delete", () => ({
  softDelete: h.softDelete,
  softDeleteMany: h.softDeleteMany,
  activeOnly: (w: object) => w,
}));
vi.mock("@/lib/services/tasks", () => ({ syncTaskPriorities: vi.fn(), scheduleGlobalPrioritySync: vi.fn() }));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn(), logUpdate: vi.fn(), stripNoise: (x: unknown) => x }));
vi.mock("@/lib/utils/cache", () => ({ invalidate: vi.fn() }));
vi.mock("@/lib/missions/durable-execution", () => ({ cancelMissionExecution: h.cancel }));

import { DELETE } from "@/app/api/missions/[id]/route";
import { getDemoState } from "@/lib/demo-store";

const call = (id: string) =>
  DELETE(
    new Request(`http://test/api/missions/${id}`, { method: "DELETE", headers: { authorization: "Bearer test" } }) as never,
    { params: Promise.resolve({ id }) } as never,
  );
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => {
  h.demo = false;
  h.softDelete.mockReset().mockResolvedValue({ ok: true });
  h.softDeleteMany.mockReset().mockResolvedValue({ count: 0, actor: "user" });
  h.cancel.mockReset().mockResolvedValue({ cancelRequested: true, missionId: "m1", eventIds: ["e1"] });
});

describe("DELETE /api/missions/[id] · a deleted mission's durable run is cancelled", () => {
  it("a successful delete cancels once, with the mission id", async () => {
    const res = await call("m1");
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(h.cancel).toHaveBeenCalledTimes(1));
    expect(h.cancel).toHaveBeenCalledWith("m1");
    await settle();
    expect(h.cancel).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: a delete that finds no mission (404) cancels nothing", async () => {
    h.softDelete.mockResolvedValue({ ok: false });
    const res = await call("ghost");
    expect(res.status).toBe(404);
    await settle();
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("CONTROL: a soft-delete that throws cancels nothing", async () => {
    h.softDelete.mockRejectedValue(new Error("db down"));
    const res = await call("m1");
    expect(res.status).toBeGreaterThanOrEqual(500);
    await settle();
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("a cancel that throws never fails the delete", async () => {
    h.cancel.mockRejectedValue(new Error("inngest 500"));
    const res = await call("m1");
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(h.cancel).toHaveBeenCalledTimes(1));
  });

  it("the mission is already deleted when the task cascade fails, so the run is still cancelled", async () => {
    h.softDeleteMany.mockRejectedValue(new Error("cascade failed"));
    const res = await call("m1");
    expect(res.status).toBeGreaterThanOrEqual(500);
    await vi.waitFor(() => expect(h.cancel).toHaveBeenCalledTimes(1));
  });

  it("demo mode touches no durable execution", async () => {
    h.demo = true;
    const id = getDemoState().missions[0].id;
    const res = await call(id);
    expect(res.status).toBe(200);
    await settle();
    expect(h.cancel).not.toHaveBeenCalled();
    expect(h.softDelete).not.toHaveBeenCalled();
  });
});
