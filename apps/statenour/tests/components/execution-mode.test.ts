import { describe, it, expect } from "vitest";
import type { Project, Task } from "@/components/actions/shared";
import { isUserProject } from "@/lib/services/mission-helpers";

function getFocusedTask(tasks: Task[], missions: Project[]): Task | null {
  // 1. First choice: a task that is currently in "DOING" status
  const doingTask = tasks.find((t) => t.status === "DOING");
  if (doingTask) return doingTask;

  // We only care about open (non-DONE, non-WAITING, non-ARCHIVED) tasks for focus recommendations
  const openTasks = tasks.filter((t) => t.status !== "DONE" && t.status !== "WAITING" && t.status !== "ARCHIVED");
  if (openTasks.length === 0) {
    // Fallback to any tasks that are not DONE or ARCHIVED if nothing else
    const anyNotDone = tasks.filter((t) => t.status !== "DONE" && t.status !== "ARCHIVED");
    if (anyNotDone.length > 0) return anyNotDone[0];
    return null;
  }

  // Helper: is the project a real user mission?
  const userMissions = missions.filter((m) => m.status === "ACTIVE" && isUserProject(m));

  // 2. Second choice: first open task of the Top Mission Today
  const picks = userMissions.map((m) => {
    const tasksForMission = openTasks.filter((t) => t.missionId === m.id);
    const days = m.deadline
      ? Math.round((new Date(m.deadline).getTime() - Date.now()) / 86400000)
      : null;
    return {
      mission: m,
      openTasks: tasksForMission.length,
      daysToDeadline: days,
    };
  }).filter((p) => p.openTasks > 0);

  if (picks.length > 0) {
    const sorted = [...picks].sort((a, b) => {
      const aD = a.daysToDeadline ?? 99_999;
      const bD = b.daysToDeadline ?? 99_999;
      if (aD !== bD) return aD - bD;
      return b.openTasks - a.openTasks;
    });
    const topMission = sorted[0]?.mission;
    if (topMission) {
      const taskForTop = openTasks.find((t) => t.missionId === topMission.id);
      if (taskForTop) return taskForTop;
    }
  }

  // 3. Third choice: first task of any active user mission
  for (const mission of userMissions) {
    const taskForMission = openTasks.find((t) => t.missionId === mission.id);
    if (taskForMission) return taskForMission;
  }

  // 4. Fallback: first open task in the general list
  return openTasks[0] || null;
}

const m = (
  id: string,
  overrides: Partial<Project> = {},
): Project => ({
  id,
  title: id,
  status: "ACTIVE",
  ...overrides,
});

const t = (
  id: string,
  missionId: string,
  status: string = "READY",
  overrides: Partial<Task> = {},
): Task => ({
  id,
  title: id,
  status,
  nextPhysicalAction: "",
  missionId,
  autoPriority: 0,
  autoPriorityExplanation: null,
  ...overrides,
});

describe("Execution Mode - focusedTask selection", () => {
  it("prioritizes DOING tasks above all else", () => {
    const missions = [m("mission-1", { deadline: new Date(Date.now() + 1000).toISOString() })];
    const tasks = [
      t("task-ready-soon", "mission-1", "READY"),
      t("task-doing", "mission-1", "DOING"),
    ];
    expect(getFocusedTask(tasks, missions)?.id).toBe("task-doing");
  });

  it("selects task of Top Mission Today based on deadline urgency when no DOING task exists", () => {
    const soon = new Date(Date.now() + 2 * 86400000).toISOString();
    const later = new Date(Date.now() + 10 * 86400000).toISOString();
    const missions = [
      m("mission-later", { deadline: later }),
      m("mission-soon", { deadline: soon }),
    ];
    const tasks = [
      t("task-later", "mission-later", "READY"),
      t("task-soon", "mission-soon", "READY"),
    ];
    expect(getFocusedTask(tasks, missions)?.id).toBe("task-soon");
  });

  it("excludes system missions like Inbox from being classified as the Top Mission Today", () => {
    const soon = new Date(Date.now() + 2 * 86400000).toISOString();
    const later = new Date(Date.now() + 10 * 86400000).toISOString();
    const missions = [
      m("inbox", { title: "Inbox", deadline: soon }),
      m("mission-later", { title: "Power Atlas v2", deadline: later }),
    ];
    const tasks = [
      t("task-inbox", "inbox", "READY"),
      t("task-later", "mission-later", "READY"),
    ];
    // Since "inbox" is a system-managed Inbox, it should not be considered a user project.
    // The selector should recommend the task from the real project.
    expect(getFocusedTask(tasks, missions)?.id).toBe("task-later");
  });

  it("falls back to first open task of any active user mission if no deadlines exist", () => {
    const missions = [
      m("mission-1"),
      m("mission-2"),
    ];
    const tasks = [
      t("task-2", "mission-2", "READY"),
      t("task-1", "mission-1", "READY"),
    ];
    expect(getFocusedTask(tasks, missions)?.id).toBe("task-1");
  });

  it("falls back to general unattached open tasks if missions have no open tasks", () => {
    const missions = [m("mission-empty")];
    const tasks = [
      t("task-unattached", "", "READY"),
    ];
    expect(getFocusedTask(tasks, missions)?.id).toBe("task-unattached");
  });

  it("falls back to WAITING tasks if no READY/DOING tasks are left", () => {
    const missions = [m("mission-1")];
    const tasks = [
      t("task-waiting", "mission-1", "WAITING"),
      t("task-done", "mission-1", "DONE"),
    ];
    expect(getFocusedTask(tasks, missions)?.id).toBe("task-waiting");
  });

  it("excludes ARCHIVED tasks from normal selection", () => {
    const missions = [m("mission-1")];
    const tasks = [
      t("task-archived", "mission-1", "ARCHIVED"),
      t("task-ready", "mission-1", "READY"),
    ];
    expect(getFocusedTask(tasks, missions)?.id).toBe("task-ready");
  });

  it("returns null when all tasks are DONE", () => {
    const missions = [m("mission-1")];
    const tasks = [
      t("task-done", "mission-1", "DONE"),
    ];
    expect(getFocusedTask(tasks, missions)).toBeNull();
  });
});
