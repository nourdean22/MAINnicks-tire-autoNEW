/**
 * Leaving ACTIVE stops a running durable mission execution (2026-10-19).
 *
 * cancelMissionExecution used to have exactly one caller: the Nick chat tool updateMissionStatus,
 * removed in wave 3. The /missions archive tap (PATCH /api/missions/[id] { status: "KILLED" }) goes
 * through updateMission and never cancelled the run, so a killed mission kept executing steps.
 * The cancel now rides the service every status change goes through.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: { findUnique: h.findUnique },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ mission: { update: h.update, count: vi.fn(async () => 0) } }),
  },
}));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));
vi.mock("@/lib/services/tasks", () => ({ syncTaskPriorities: vi.fn(), scheduleGlobalPrioritySync: vi.fn() }));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn(), logUpdate: vi.fn(), stripNoise: (x: unknown) => x }));
vi.mock("@/lib/utils/cache", () => ({ invalidate: vi.fn() }));
vi.mock("@/lib/missions/durable-execution", () => ({ cancelMissionExecution: h.cancel }));

import { updateMission } from "@/lib/services/missions";

beforeEach(() => {
  h.findUnique.mockReset().mockResolvedValue({ id: "m1", title: "T", status: "ACTIVE" });
  h.update.mockReset().mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: "m1", title: "T", ...a.data }));
  h.cancel.mockReset().mockResolvedValue({ cancelRequested: true, missionId: "m1", eventIds: ["e1"] });
});

describe("updateMission · a status change away from ACTIVE cancels the durable run", () => {
  it.each(["KILLED", "COMPLETE", "PAUSED"])("ACTIVE -> %s cancels once", async (status) => {
    await updateMission("m1", { status });
    await vi.waitFor(() => expect(h.cancel).toHaveBeenCalledTimes(1));
    expect(h.cancel).toHaveBeenCalledWith("m1");
  });

  it("CONTROL: a title edit, or the same status again, cancels nothing", async () => {
    await updateMission("m1", { title: "Renamed" });
    await updateMission("m1", { status: "ACTIVE" });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("a cancel that throws never fails the status change", async () => {
    h.cancel.mockRejectedValue(new Error("inngest 500"));
    await expect(updateMission("m1", { status: "KILLED" })).resolves.toBeTruthy();
    expect(h.update).toHaveBeenCalledTimes(1);
  });
});
