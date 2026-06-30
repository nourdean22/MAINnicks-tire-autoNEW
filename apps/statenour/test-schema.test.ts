import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock prisma and all service-layer deps so no real DB connection is needed.
// Pattern mirrors missions-enriched.test.ts and guardian.test.ts.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    mission: {
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    brainMemory: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/services/auto-learn", () => ({
  runAutoLearn: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/mastery/goal-stats", () => ({
  creditTaskStats: vi.fn().mockResolvedValue({ statsCredited: 0, xpCredited: 0 }),
}));

vi.mock("@/lib/db/brain-bus-emit", () => ({
  emitTaskCompleted: vi.fn(),
}));

vi.mock("@/lib/brain/task-events", () => ({
  emitTaskEventAsync: vi.fn(),
}));

vi.mock("@/lib/services/tasks", () => ({
  createTask: vi.fn(),
  liftGoalOnTaskComplete: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "@/lib/prisma";
import { checkTask } from "@/lib/services/task-actions";
import { OutcomeRating } from "@prisma/client";

const TASK_ID = "test-task-id";

const MOCK_TASK = {
  id: TASK_ID,
  title: "Temporary Validation Test Task",
  finishCondition: "Perform automated validation checks",
  missionId: "test-mission-id",
  loopKind: "ONCE",
  status: "READY",
  lastCompletedAt: null,
  streakCount: 0,
  startedAt: null,
  actualMinutes: null,
  context: "DESK",
  effort: "M5",
  autoPriority: null,
  roiScore: 50,
  goalId: null,
  mission: { title: "Temporary Test Mission", domain: "PERSONAL" },
  goal: null,
};

describe("Task Outcome Score, Rating, and Lesson Validation Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.task.findUnique).mockResolvedValue(MOCK_TASK as any);
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: TASK_ID,
      status: "DONE",
      loopKind: "ONCE",
      actualMinutes: 0,
      effort: "M5",
    } as any);
    vi.mocked(prisma.task.findMany).mockResolvedValue([]);
    vi.mocked(prisma.brainMemory.upsert).mockResolvedValue({} as any);
  });

  it("should fail when outcome score is invalid", async () => {
    // Score out of range (0)
    await expect(
      checkTask({ id: TASK_ID, action: "complete", outcomeScore: 0 })
    ).rejects.toThrow("Outcome score must be an integer between 1 and 100");

    // Score out of range (101)
    await expect(
      checkTask({ id: TASK_ID, action: "complete", outcomeScore: 101 })
    ).rejects.toThrow("Outcome score must be an integer between 1 and 100");

    // Decimal score (50.5)
    await expect(
      checkTask({ id: TASK_ID, action: "complete", outcomeScore: 50.5 })
    ).rejects.toThrow("Outcome score must be an integer between 1 and 100");
  });

  it("should fail when outcome rating is invalid", async () => {
    await expect(
      checkTask({ id: TASK_ID, action: "complete", outcomeRating: "INVALID_RATING" as any })
    ).rejects.toThrow("Outcome rating must be one of");
  });

  it("should fail when outcome lesson is too long", async () => {
    const longLesson = "a".repeat(5001);
    await expect(
      checkTask({ id: TASK_ID, action: "complete", outcomeLesson: longLesson })
    ).rejects.toThrow("Outcome lesson must not exceed 5000 characters");
  });

  it("should successfully complete task with valid outcome rating, score, and lesson", async () => {
    const result = await checkTask({
      id: TASK_ID,
      action: "complete",
      completionNote: "Successful test completion",
      outcomeScore: 95,
      outcomeRating: OutcomeRating.OUTSTANDING,
      outcomeLesson: "Always verify schema column changes live on target DB before cutover.",
    });

    expect(result.task?.status).toBe("DONE");

    // Verify prisma.task.update was called with the correct outcome fields —
    // equivalent to reading back the DB record in the original integration test,
    // but without requiring a live DB connection.
    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK_ID },
        data: expect.objectContaining({
          status: "DONE",
          outcomeScore: 95,
          outcomeRating: OutcomeRating.OUTSTANDING,
          outcomeLesson: "Always verify schema column changes live on target DB before cutover.",
        }),
      })
    );
  });
});
