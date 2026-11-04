/**
 * W8c manager round 1 P2-14 · the two procedures behind the mission goal link, through the real router:
 * task.suggestMissionGoal passes a failed read through as an error (the drawer's "couldn't suggest"), never as an
 * empty answer; task.missionUpdate turns the service's refused goal (400) into BAD_REQUEST, not a server error.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ status: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/missions/suggest-goal", () => ({ suggestGoalStatusForMission: h.status }));
vi.mock("@/lib/services/missions", async (orig) => ({ ...(await orig<typeof import("@/lib/services/missions")>()), updateMission: h.update }));

import { appRouter } from "@/lib/trpc/root";
import { ServiceError } from "@/lib/utils/service-error";

const caller = () =>
  appRouter.createCaller({
    session: { id: "operator-1", email: "operator@statenour.local", role: "operator" },
    db: {} as never,
  } as never);

beforeEach(() => {
  h.status.mockReset();
  h.update.mockReset();
});

describe("task.suggestMissionGoal", () => {
  it("a failed read rejects; it never becomes an empty answer", async () => {
    h.status.mockRejectedValue(new Error("db down"));
    await expect(caller().task.suggestMissionGoal({ missionId: "m1" })).rejects.toThrow("db down");
  });

  it("passes the measured status through unchanged", async () => {
    h.status.mockResolvedValue({ status: "no_match", basis: "words" });
    expect(await caller().task.suggestMissionGoal({ missionId: "m1" })).toEqual({ status: "no_match", basis: "words" });
    expect(h.status).toHaveBeenCalledWith("m1");
  });
});

describe("task.missionUpdate", () => {
  it("a refused goal (ServiceError 400) is BAD_REQUEST with the service's message", async () => {
    h.update.mockRejectedValue(new ServiceError("That goal is not an active goal.", 400));
    await expect(caller().task.missionUpdate({ id: "m1", fields: { lifeGoalId: "Hit 15K" } })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "That goal is not an active goal.",
    });
  });

  it("CONTROL: a missing mission is still NOT_FOUND", async () => {
    h.update.mockRejectedValue(new ServiceError("Mission not found.", 404));
    await expect(caller().task.missionUpdate({ id: "m1", fields: {} })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
