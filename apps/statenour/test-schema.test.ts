import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./lib/prisma";
import { checkTask } from "./lib/services/task-actions";
import { OutcomeRating, EffortBand, EnergyLevel, TaskContext, MissionDomain } from "@prisma/client";

describe("Task Outcome Score, Rating, and Lesson Validation Tests", () => {
  let testTaskId: string;
  let testMissionId: string;
  let createdMission = false;

  beforeAll(async () => {
    // 1. Find or create a mission to satisfy foreign key requirement
    let mission = await prisma.mission.findFirst();
    if (!mission) {
      mission = await prisma.mission.create({
        data: {
          title: "Temporary Test Mission",
          domain: MissionDomain.PERSONAL,
          priority: 1,
          roiScore: 5,
          neglectCost: 5,
          status: "ACTIVE",
        },
      });
      createdMission = true;
    }
    testMissionId = mission.id;

    // 2. Create a temporary task for testing with all required fields
    const task = await prisma.task.create({
      data: {
        title: "Temporary Validation Test Task",
        finishCondition: "Perform automated validation checks",
        status: "READY",
        loopKind: "ONCE",
        nextPhysicalAction: "Verify task outcomes",
        effort: EffortBand.M5,
        roiScore: 5,
        frictionScore: 5,
        energyRequired: EnergyLevel.MEDIUM,
        context: TaskContext.DESK,
        missionId: testMissionId,
      },
    });
    testTaskId = task.id;
  });

  afterAll(async () => {
    // Cleanup the task
    if (testTaskId) {
      await prisma.task.delete({
        where: { id: testTaskId },
      });
    }
    // Cleanup the mission if we created it
    if (createdMission && testMissionId) {
      await prisma.mission.delete({
        where: { id: testMissionId },
      });
    }
  });

  it("should fail when outcome score is invalid", async () => {
    // 1. Score out of range (0)
    await expect(
      checkTask({ id: testTaskId, action: "complete", outcomeScore: 0 })
    ).rejects.toThrow("Outcome score must be an integer between 1 and 100");

    // 2. Score out of range (101)
    await expect(
      checkTask({ id: testTaskId, action: "complete", outcomeScore: 101 })
    ).rejects.toThrow("Outcome score must be an integer between 1 and 100");

    // 3. Decimal score (50.5)
    await expect(
      checkTask({ id: testTaskId, action: "complete", outcomeScore: 50.5 })
    ).rejects.toThrow("Outcome score must be an integer between 1 and 100");
  });

  it("should fail when outcome rating is invalid", async () => {
    await expect(
      checkTask({ id: testTaskId, action: "complete", outcomeRating: "INVALID_RATING" as any })
    ).rejects.toThrow("Outcome rating must be one of");
  });

  it("should fail when outcome lesson is too long", async () => {
    const longLesson = "a".repeat(5001);
    await expect(
      checkTask({ id: testTaskId, action: "complete", outcomeLesson: longLesson })
    ).rejects.toThrow("Outcome lesson must not exceed 5000 characters");
  });

  it("should successfully complete task with valid outcome rating, score, and lesson", async () => {
    const result = await checkTask({
      id: testTaskId,
      action: "complete",
      completionNote: "Successful test completion",
      outcomeScore: 95,
      outcomeRating: OutcomeRating.OUTSTANDING,
      outcomeLesson: "Always verify schema column changes live on target DB before cutover.",
    });

    expect(result.task?.status).toBe("DONE");

    // Verify database record has correct fields
    const taskRecord = await prisma.task.findUnique({
      where: { id: testTaskId },
    });

    expect(taskRecord?.outcomeScore).toBe(95);
    expect(taskRecord?.outcomeRating).toBe(OutcomeRating.OUTSTANDING);
    expect(taskRecord?.outcomeLesson).toBe("Always verify schema column changes live on target DB before cutover.");
  });
});
