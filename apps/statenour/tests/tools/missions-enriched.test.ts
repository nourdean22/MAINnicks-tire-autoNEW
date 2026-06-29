import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { missionsTools } from "@/lib/ai/tools/missions";

describe("missionsTools - addTasksToProject enriched bulk creation", () => {
  let tempMissionId: string;

  beforeEach(async () => {
    // Create a temporary mission to link tasks to
    const m = await prisma.mission.create({
      data: {
        title: "Test Enriched Mission",
        domain: "PERSONAL",
        priority: 50,
        roiScore: 50,
        neglectCost: 35,
        status: "ACTIVE",
      },
    });
    tempMissionId = m.id;
  });

  afterEach(async () => {
    // Clean up created tasks and missions
    const tasks = await prisma.task.findMany({
      where: { missionId: tempMissionId },
      select: { id: true },
    });
    const taskIds = tasks.map(t => t.id);
    if (taskIds.length > 0) {
      await prisma.taskEvent.deleteMany({
        where: { taskId: { in: taskIds } },
      });
    }
    await prisma.task.deleteMany({
      where: { missionId: tempMissionId },
    });
    await prisma.mission.delete({
      where: { id: tempMissionId },
    });
  });

  it("should create tasks in bulk with correct loopKind and recurringDays", async () => {
    const executeFn = missionsTools.addTasksToProject.execute;
    
    const result = await executeFn({
      missionId: tempMissionId,
      tasks: [
        {
          title: "Monday Morning Reset",
          nextPhysicalAction: "Sit at desk and open planner",
          effort: "M15",
          context: "DESK",
          loopKind: "WEEKLY",
          recurringDays: [1], // Monday
        },
        {
          title: "Drink Water Daily",
          nextPhysicalAction: "Go to kitchen and fill cup",
          effort: "M5",
          context: "HOME",
          loopKind: "DAILY",
        }
      ],
    });

    expect(result.created).toBe(true);
    expect(result.count).toBe(2);

    // Verify in database
    const dbTasks = await prisma.task.findMany({
      where: { missionId: tempMissionId },
      orderBy: { title: "asc" },
    });

    expect(dbTasks.length).toBe(2);
    
    // Drink Water Daily
    expect(dbTasks[0].title).toBe("Drink Water Daily");
    expect(dbTasks[0].loopKind).toBe("DAILY");
    expect(dbTasks[0].recurringDays).toEqual([]);

    // Monday Morning Reset
    expect(dbTasks[1].title).toBe("Monday Morning Reset");
    expect(dbTasks[1].loopKind).toBe("WEEKLY");
    expect(dbTasks[1].recurringDays).toEqual([1]);
  });
});
