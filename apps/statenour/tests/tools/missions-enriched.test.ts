import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock prisma and the task service so this test runs without a DB connection.
// Pattern mirrors guardian.test.ts, tool-policy.test.ts, etc.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: {
      create: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    taskEvent: {
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/services/tasks", () => ({
  createTaskAndEnrich: vi.fn(),
}));

import { createTaskAndEnrich } from "@/lib/services/tasks";
import { missionsTools } from "@/lib/ai/tools/missions";
import { prisma } from "@/lib/prisma";
import { GENERAL_ANCHOR_KIND } from "@/lib/missions/domains";

const MISSION_ID = "test-mission-id";

describe("missionsTools - getMissions inbox/anchor boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes Inbox rows and GENERAL anchors, returns only user projects", async () => {
    // 2026-07-10 regression guard · the chat tool previously returned
    // system-managed rows as if they were user projects (4th surface of
    // the bug class documented in lib/services/mission-helpers.ts).
    vi.mocked(prisma.mission.findMany).mockResolvedValue([
      { id: "m1", title: "Inbox", domain: "BUSINESS", priority: 90, status: "ACTIVE", systemKind: null },
      { id: "m2", title: "Inbox - business", domain: "BUSINESS", priority: 80, status: "ACTIVE", systemKind: null },
      { id: "m3", title: "General ops", domain: "BUSINESS", priority: 70, status: "ACTIVE", systemKind: GENERAL_ANCHOR_KIND },
      { id: "m4", title: "Launch tire campaign", domain: "BUSINESS", priority: 60, status: "ACTIVE", systemKind: null },
    ] as any);

    const result = await missionsTools.getMissions.execute({} as any, {} as any);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "m4",
      title: "Launch tire campaign",
      domain: "BUSINESS",
      priority: 60,
      status: "ACTIVE",
    });
    // systemKind is an internal predicate input, not tool output.
    expect(result[0]).not.toHaveProperty("systemKind");
  });

  it("returns [] when the DB query throws (fail-soft contract preserved)", async () => {
    vi.mocked(prisma.mission.findMany).mockRejectedValue(new Error("db down"));
    const result = await missionsTools.getMissions.execute({} as any, {} as any);
    expect(result).toEqual([]);
  });
});

describe("missionsTools - addTasksToProject enriched bulk creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mirror loopKind / recurringDays back from args so execute's return
    // value reflects what was passed (same contract as the real service).
    vi.mocked(createTaskAndEnrich).mockImplementation(async (args) => ({
      id: `task-${Math.random().toString(36).slice(2)}`,
      title: args.title,
      loopKind: args.loopKind,
      recurringDays: args.recurringDays ?? [],
    }) as any);
  });

  it("should create tasks in bulk with correct loopKind and recurringDays", async () => {
    const result = await missionsTools.addTasksToProject.execute({
      missionId: MISSION_ID,
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
        },
      ],
    });

    expect(result.created).toBe(true);
    expect(result.count).toBe(2);

    // Verify createTaskAndEnrich received the right loopKind + recurringDays
    // for each task — this is the core business logic the test guards.
    expect(createTaskAndEnrich).toHaveBeenCalledTimes(2);

    const calls = vi.mocked(createTaskAndEnrich).mock.calls;
    const weeklyArgs = calls.find(([a]) => a.title === "Monday Morning Reset")?.[0];
    const dailyArgs  = calls.find(([a]) => a.title === "Drink Water Daily")?.[0];

    expect(weeklyArgs?.loopKind).toBe("WEEKLY");
    expect(weeklyArgs?.recurringDays).toEqual([1]);

    expect(dailyArgs?.loopKind).toBe("DAILY");
    expect(dailyArgs?.recurringDays).toEqual([]);
  });
});
