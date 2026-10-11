/**
 * updateMissionStatus stops a durable run (audit B7, 2026-10-10).
 *
 * Before: cancelMissionExecution existed with no caller, so pausing,
 * completing or killing a mission left its background run going. Now a
 * move to any non-ACTIVE status sends the cancel, and the tool result says
 * whether the cancel was accepted. A cancel failure is loud, never fatal to
 * the status change that already committed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMissionFindFirst = vi.fn();
const mockMissionUpdate = vi.fn();
const mockAuditCreate = vi.fn(() => Promise.resolve({}));
const mockCancel = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: {
      findFirst: (a: unknown) => mockMissionFindFirst(a),
      update: (a: unknown) => mockMissionUpdate(a),
    },
    auditEvent: { create: (a: unknown) => mockAuditCreate(a) },
  },
}));
vi.mock("@/lib/services/tasks", () => ({ createTaskAndEnrich: vi.fn() }));
vi.mock("@/lib/missions/durable-execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/missions/durable-execution")>();
  return {
    ...actual,
    cancelMissionExecution: (...a: unknown[]) => mockCancel(...a),
  };
});

import { missionsTools } from "@/lib/ai/tools/missions";

type Exec = (args: unknown) => Promise<Record<string, unknown>>;
const update = (args: unknown) =>
  (missionsTools.updateMissionStatus as unknown as { execute: Exec }).execute(args);

function transition(from: string, to: string) {
  mockMissionFindFirst.mockResolvedValueOnce({ id: "m1", title: "T", status: from });
  mockMissionUpdate.mockResolvedValueOnce({ id: "m1", title: "T", status: to });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCancel.mockResolvedValue({ cancelRequested: true, missionId: "m1", eventIds: ["evt-c"] });
});

describe("updateMissionStatus -> cancelMissionExecution", () => {
  for (const to of ["PAUSED", "COMPLETE", "KILLED"]) {
    it(`ACTIVE -> ${to} cancels the mission's durable run and reports it`, async () => {
      transition("ACTIVE", to);
      const r = await update({ missionId: "m1", status: to });
      expect(mockCancel).toHaveBeenCalledWith("m1");
      expect(r).toMatchObject({
        changed: true,
        status: to,
        executionCancel: { cancelRequested: true, eventIds: ["evt-c"] },
      });
    });
  }

  it("cancels only after the status write committed", async () => {
    mockMissionFindFirst.mockResolvedValueOnce({ id: "m1", title: "T", status: "ACTIVE" });
    mockMissionUpdate.mockRejectedValueOnce(new Error("db down"));
    await expect(update({ missionId: "m1", status: "PAUSED" })).rejects.toThrow();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("CONTROL: re-activating does not cancel", async () => {
    transition("PAUSED", "ACTIVE");
    const r = await update({ missionId: "m1", status: "ACTIVE" });
    expect(mockCancel).not.toHaveBeenCalled();
    expect(r).not.toHaveProperty("executionCancel");
  });

  it("CONTROL: a same-status no-op does not cancel", async () => {
    mockMissionFindFirst.mockResolvedValueOnce({ id: "m1", title: "T", status: "PAUSED" });
    await update({ missionId: "m1", status: "PAUSED" });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("a cancel that throws does not fail the committed status change, and says so", async () => {
    transition("ACTIVE", "KILLED");
    mockCancel.mockRejectedValueOnce(new Error("inngest 500"));
    const r = await update({ missionId: "m1", status: "KILLED" });
    expect(r).toMatchObject({
      changed: true,
      status: "KILLED",
      executionCancel: { cancelRequested: false, reason: "cancel_send_failed" },
    });
  });
});
