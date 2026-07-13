/**
 * createTaskAndEnrich · mission-FK error-proofing · 2026-07-12
 *
 * Regression guard for the chat "TOOL FAILED" cards. createTask's schema
 * makes `missionId` a REQUIRED field the LLM must supply, but the model has
 * no reliable way to know a valid mission id mid-conversation — so it
 * hallucinated one. Task.missionId is a hard FK (onDelete: Restrict), so the
 * bare `prisma.task.create` threw P2003, which the AI SDK surfaced in chat as
 * a red "TOOL FAILED" card (proven in prod: creating with a bogus id →
 * "Foreign key constraint violated on Task_missionId_fkey").
 *
 * The fix resolves an invalid/empty missionId to the Inbox anchor so the
 * create can never FK-throw; enrichTaskLinkage (fire-and-forget) then re-files
 * the task into the right mission by title classification.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  mission: { findUnique: vi.fn() },
  lifeGoal: { findUnique: vi.fn() },
  resolveInboxMissionId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { task: mocks.task, mission: mocks.mission, lifeGoal: mocks.lifeGoal },
}));

// Force the real-prisma branch (test env otherwise trips isDemoMode).
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));

vi.mock("@/lib/services/missions", () => ({
  resolveInboxMissionId: mocks.resolveInboxMissionId,
  resolveGeneralAnchorId: vi.fn().mockResolvedValue(null),
}));

import { createTaskAndEnrich } from "@/lib/services/tasks";

const INBOX = "m-inbox";
const baseData = {
  title: "Draft the newsletter",
  nextPhysicalAction: "open doc",
  effort: "M30",
  context: "DESK",
  roiScore: 50,
  frictionScore: 30,
  energyRequired: "MEDIUM",
  finishCondition: "x",
  loopKind: "ONCE",
} as any;

const createdData = () => mocks.task.create.mock.calls[0][0].data;
const createdMissionId = () => createdData().missionId;

describe("createTaskAndEnrich · mission FK error-proofing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveInboxMissionId.mockResolvedValue(INBOX);
    // enrichTaskLinkage is fire-and-forget and returns early when the task
    // row read comes back null — keeps this unit test off the classifier.
    mocks.task.findUnique.mockResolvedValue(null);
    mocks.task.create.mockImplementation(async (a: any) => ({ id: "t1", ...a.data }));
    // Default: no recent duplicate → the create path runs.
    mocks.task.findMany.mockResolvedValue([]);
    // Default: any supplied goalId is considered valid unless a test overrides.
    mocks.lifeGoal.findUnique.mockResolvedValue({ id: "g-real" });
  });

  it("uses the chosen missionId when it exists — no Inbox fallback", async () => {
    mocks.mission.findUnique.mockResolvedValue({ id: "m-real" });
    await createTaskAndEnrich({ ...baseData, missionId: "m-real" });
    expect(mocks.mission.findUnique).toHaveBeenCalledWith({
      where: { id: "m-real" },
      select: { id: true },
    });
    expect(mocks.resolveInboxMissionId).not.toHaveBeenCalled();
    expect(createdMissionId()).toBe("m-real");
  });

  it("falls back to Inbox when the chosen missionId does not exist (the P2003 case)", async () => {
    mocks.mission.findUnique.mockResolvedValue(null); // hallucinated id
    await createTaskAndEnrich({ ...baseData, missionId: "m-hallucinated" });
    expect(mocks.resolveInboxMissionId).toHaveBeenCalledTimes(1);
    expect(createdMissionId()).toBe(INBOX);
  });

  it("falls back to Inbox when missionId is empty (never hits the DB check)", async () => {
    await createTaskAndEnrich({ ...baseData, missionId: "" });
    expect(mocks.mission.findUnique).not.toHaveBeenCalled();
    expect(mocks.resolveInboxMissionId).toHaveBeenCalledTimes(1);
    expect(createdMissionId()).toBe(INBOX);
  });

  it("never FK-throws even when the mission existence check itself errors", async () => {
    mocks.mission.findUnique.mockRejectedValue(new Error("db blip"));
    await createTaskAndEnrich({ ...baseData, missionId: "m-x" });
    expect(mocks.resolveInboxMissionId).toHaveBeenCalledTimes(1);
    expect(createdMissionId()).toBe(INBOX);
  });

  it("drops a hallucinated goalId to null (Task_goalId_fkey P2003 case)", async () => {
    mocks.mission.findUnique.mockResolvedValue({ id: "m-real" });
    mocks.lifeGoal.findUnique.mockResolvedValue(null); // goal doesn't exist
    await createTaskAndEnrich({ ...baseData, missionId: "m-real", goalId: "g-hallucinated" });
    expect(createdMissionId()).toBe("m-real");
    expect(createdData().goalId).toBeNull();
  });

  it("keeps a valid goalId untouched", async () => {
    mocks.mission.findUnique.mockResolvedValue({ id: "m-real" });
    mocks.lifeGoal.findUnique.mockResolvedValue({ id: "g-real" });
    await createTaskAndEnrich({ ...baseData, missionId: "m-real", goalId: "g-real" });
    expect(createdData().goalId).toBe("g-real");
    expect(mocks.lifeGoal.findUnique).toHaveBeenCalledWith({
      where: { id: "g-real" },
      select: { id: true },
    });
  });

  it("does not query lifeGoal when no goalId is supplied", async () => {
    mocks.mission.findUnique.mockResolvedValue({ id: "m-real" });
    await createTaskAndEnrich({ ...baseData, missionId: "m-real" });
    expect(mocks.lifeGoal.findUnique).not.toHaveBeenCalled();
  });
});

describe("createTaskAndEnrich · retry-duplicate collapse (idempotency)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveInboxMissionId.mockResolvedValue(INBOX);
    mocks.mission.findUnique.mockResolvedValue({ id: "m-real" });
    mocks.lifeGoal.findUnique.mockResolvedValue({ id: "g-real" });
    mocks.task.findUnique.mockResolvedValue(null);
    mocks.task.create.mockImplementation(async (a: any) => ({ id: "t-new", ...a.data }));
    mocks.task.findMany.mockResolvedValue([]);
  });

  const dueToday = new Date();

  it("returns the existing task instead of creating a duplicate (same title + same due day, recent)", async () => {
    const existing = { id: "t-existing", title: "Conduct weekly ROI meetings", dueDate: dueToday };
    mocks.task.findMany.mockResolvedValue([existing]);
    const result = await createTaskAndEnrich({
      ...baseData, title: "Conduct weekly ROI meetings", missionId: "m-real", dueDate: dueToday,
    } as any);
    expect(result.id).toBe("t-existing");
    expect(mocks.task.create).not.toHaveBeenCalled(); // no duplicate written
  });

  it("still creates when the same title exists but on a DIFFERENT due day", async () => {
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    mocks.task.findMany.mockResolvedValue([
      { id: "t-old", title: "Conduct weekly ROI meetings", dueDate: yesterday },
    ]);
    const result = await createTaskAndEnrich({
      ...baseData, title: "Conduct weekly ROI meetings", missionId: "m-real", dueDate: dueToday,
    } as any);
    expect(result.id).toBe("t-new");
    expect(mocks.task.create).toHaveBeenCalledTimes(1);
  });

  it("creates normally when there is no recent same-title task", async () => {
    mocks.task.findMany.mockResolvedValue([]);
    const result = await createTaskAndEnrich({ ...baseData, missionId: "m-real", dueDate: dueToday } as any);
    expect(result.id).toBe("t-new");
    expect(mocks.task.create).toHaveBeenCalledTimes(1);
  });

  it("never blocks a create when the duplicate lookup itself errors", async () => {
    mocks.task.findMany.mockRejectedValue(new Error("db blip"));
    const result = await createTaskAndEnrich({ ...baseData, missionId: "m-real" } as any);
    expect(result.id).toBe("t-new");
    expect(mocks.task.create).toHaveBeenCalledTimes(1);
  });
});
