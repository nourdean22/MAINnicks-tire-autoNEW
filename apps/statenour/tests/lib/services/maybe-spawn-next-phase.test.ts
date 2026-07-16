/**
 * maybeSpawnNextPhase transaction tests · Track B.3
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: {
    count: vi.fn(),
    create: vi.fn(),
  },
  mission: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    mission: mocks.mission,
    $transaction: vi.fn(async (fn) =>
      fn({
        task: mocks.task,
        mission: mocks.mission,
      }),
    ),
  },
}));

vi.mock("@/lib/demo-store", () => ({
  getDemoState: vi.fn(() => ({})),
  makeDemoId: vi.fn(() => "demo-id"),
}));
vi.mock("@/lib/db/entity-audit", () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  stripNoise: vi.fn((x) => x),
}));

import { maybeSpawnNextPhase } from "@/lib/services/tasks";

describe("maybeSpawnNextPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips spawning if other open tasks exist in the current phase", async () => {
    mocks.task.count.mockResolvedValueOnce(1); // 1 other open task

    await maybeSpawnNextPhase("mission-1", "Phase 1");

    expect(mocks.task.count).toHaveBeenCalledWith({
      where: {
        missionId: "mission-1",
        phaseName: "Phase 1",
        // phantom-counts wave: soft-deleted tasks must not block
        // next-phase spawning — "open" means live rows only.
        deletedAt: null,
        status: { in: ["INBOX", "READY", "DOING", "WAITING"] },
      },
    });
    expect(mocks.mission.findUnique).not.toHaveBeenCalled();
  });

  it("skips spawning if next phase steps already have taskIds", async () => {
    mocks.task.count.mockResolvedValueOnce(0); // no open tasks
    mocks.mission.findUnique.mockResolvedValueOnce({
      id: "mission-1",
      planData: {
        v: 1,
        phases: [
          {
            name: "Phase 1",
            steps: [{ title: "Step 1", taskId: "t-1" }],
          },
          {
            name: "Phase 2",
            steps: [{ title: "Step 2", taskId: "t-2" }], // already has taskId set
          },
        ],
        updatedAt: "2026-06-29T12:00:00Z",
      },
    });

    await maybeSpawnNextPhase("mission-1", "Phase 1");

    expect(mocks.task.count).toHaveBeenCalled();
    expect(mocks.mission.findUnique).toHaveBeenCalled();
    // Should NOT enter transaction to spawn
    expect(mocks.task.create).not.toHaveBeenCalled();
  });

  it("spawns next phase tasks inside a transaction and updates the mission planData", async () => {
    mocks.task.count.mockResolvedValueOnce(0); // last task completed
    mocks.mission.findUnique.mockResolvedValueOnce({
      id: "mission-1",
      planData: {
        v: 1,
        phases: [
          {
            name: "Phase 1",
            steps: [{ title: "Step 1", taskId: "t-1" }],
          },
          {
            name: "Phase 2",
            steps: [
              { title: "Step 2", nextAction: "Do step 2", effort: "M15" },
              { title: "Step 3", isCheckpoint: true },
            ],
          },
        ],
        updatedAt: "2026-06-29T12:00:00Z",
      },
    });
    mocks.task.create
      .mockResolvedValueOnce({ id: "spawned-t2" })
      .mockResolvedValueOnce({ id: "spawned-t3" });

    await maybeSpawnNextPhase("mission-1", "Phase 1");

    expect(mocks.task.create).toHaveBeenCalledTimes(2);
    expect(mocks.mission.update).toHaveBeenCalledTimes(1);

    // Verify task creation calls
    const call1 = mocks.task.create.mock.calls[0][0];
    expect(call1.data).toEqual(
      expect.objectContaining({
        title: "Step 2",
        missionId: "mission-1",
        status: "READY",
        nextPhysicalAction: "Do step 2",
        phaseName: "Phase 2",
      }),
    );

    const call2 = mocks.task.create.mock.calls[1][0];
    expect(call2.data).toEqual(
      expect.objectContaining({
        title: "Step 3",
        missionId: "mission-1",
        status: "READY",
        phaseName: "Phase 2",
        finishCondition: "Checkpoint reached",
      }),
    );

    // Verify planData update call
    const updateArgs = mocks.mission.update.mock.calls[0][0];
    const plan = updateArgs.data.planData;
    expect(plan.phases[1].steps[0].taskId).toBe("spawned-t2");
    expect(plan.phases[1].steps[1].taskId).toBe("spawned-t3");
  });
});
