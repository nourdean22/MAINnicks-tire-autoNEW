/**
 * Auto-inherit goalId on task creation · May 02
 *
 * The Goal↔Project bridge lives at the task level (Mission has no
 * goalId column). When a project is linked to a goal via "+ project"
 * / "+ goal", only the EXISTING tasks at link-time get the goalId
 * PATCH'd in. New tasks added later didn't auto-inherit, so the goal
 * would show "100% (1/1 done)" while the project still had open
 * tasks — a real UX confusion.
 *
 * The fix: when creating a task with no explicit goalId, look at
 * sibling tasks under the same missionId. If they all share exactly
 * one goalId, inherit it. If they span multiple goals, abstain.
 *
 * Three branches to verify:
 *   1. Single distinct goal across siblings → inherit
 *   2. Two or more distinct goals → abstain (don't override the user's
 *      intentional split)
 *   3. No siblings have goalId set → no inheritance, leave null
 *   4. Caller passed an explicit goalId → respect it, never override
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  mission: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  lifeGoal: {
    findMany: vi.fn(),
  },
  taskClassificationCorrection: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    mission: mocks.mission,
    lifeGoal: mocks.lifeGoal,
    taskClassificationCorrection: mocks.taskClassificationCorrection,
    $transaction: vi.fn(async (fn) =>
      fn({
        task: mocks.task,
        mission: mocks.mission,
      }),
    ),
  },
}));

// 2026-07-25 · createTask fires `void enrichTaskLinkage(id)` — a
// fire-and-forget chain that touches prisma.mission / prisma.lifeGoal /
// prisma.taskClassificationCorrection AND the AI classifier. With those
// missing from the mock, evaluating its Promise.all threw synchronously
// (reading `.findMany` of undefined), orphaning the sibling
// resolveInboxMissionId() promise → 12 unhandled-rejection errors that
// failed the whole vitest run (exit 1) even with every test green.
// Stub the classifier inert (all-null result → every write branch in
// enrichTaskLinkage no-ops) and give the extra models real promises.
vi.mock("@/lib/ai/classify-task-linkage", () => ({
  classifyTaskLinkage: vi.fn().mockResolvedValue({
    missionId: null,
    goalId: null,
    statHints: [],
    confidence: 0,
    rationale: "",
    domain: null,
  }),
}));

vi.mock("@/lib/db/entity-audit", () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  stripNoise: vi.fn((x) => x),
}));

vi.mock("@/lib/cache/dashboard-cache", () => ({
  invalidateMutationCaches: vi.fn(),
}));

vi.mock("@/lib/brain/task-events", () => ({
  emitTaskEventAsync: vi.fn(),
}));

// Force the real-prisma branch — without this the demo store kicks in
// (NODE_ENV/test triggers isDemoMode) and ignores our prisma mock.
vi.mock("@/lib/runtime", () => ({
  isDemoMode: false,
}));

// Top-level import so vi.mock's hoisted prisma mock applies.
import { createTask } from "@/lib/services/tasks";

// File-level defaults for every surface the fire-and-forget enrichment
// path can touch. Runs BEFORE each describe's own beforeEach; the
// per-block `vi.clearAllMocks()` clears calls, not implementations, so
// these survive and per-block mockResolvedValue overrides still win.
beforeEach(() => {
  mocks.task.updateMany.mockResolvedValue({ count: 0 });
  mocks.mission.findFirst.mockResolvedValue(null);
  mocks.lifeGoal.findMany.mockResolvedValue([]);
  mocks.taskClassificationCorrection.findMany.mockResolvedValue([]);
});

const baseInput = {
  title: "new task",
  missionId: "mission-1",
  status: "INBOX" as const,
  nextPhysicalAction: "do the thing",
  effort: "M15" as const,
  roiScore: 50,
  frictionScore: 30,
  energyRequired: "MEDIUM" as const,
  context: "ANYWHERE" as const,
  finishCondition: "Done",
  loopKind: "ONCE" as const,
  delegatable: false,
  driftRisk: 0,
};

describe("createTask · auto-inherit goalId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mission must exist for ensureMissionExists() to pass.
    mocks.mission.findUnique.mockResolvedValue({ id: "mission-1", deletedAt: null });
    mocks.mission.findMany.mockResolvedValue([]);
    // Default task.create returns a stub task; tests assert the
    // `data` payload includes the inherited goalId (or doesn't).
    mocks.task.create.mockImplementation(async (args: { data: { goalId?: string | null } }) => ({
      id: "new-task-id",
      ...args.data,
    }));
    mocks.task.findUnique.mockResolvedValue({
      id: "new-task-id",
      missionId: "mission-1",
      title: "new task",
      status: "INBOX",
      mission: { id: "mission-1", title: "Mission 1" },
    });
    // syncTaskPriorities iterates tasks and calls update — return an
    // empty list so it's a no-op.
    mocks.task.update.mockResolvedValue({});
  });

  it("inherits goalId when all sibling tasks share exactly one goal", async () => {
    // Two findMany calls in createTask: (1) sibling-goalId scan, (2)
    // the syncTaskPriorities sweep. First returns sibling rows, second
    // returns empty so the priority sync no-ops.
    mocks.task.findMany
      .mockResolvedValueOnce([{ goalId: "goal-a" }, { goalId: "goal-a" }])
      .mockResolvedValue([]);

    await createTask(baseInput);

    expect(mocks.task.create).toHaveBeenCalled();
    const createArgs = mocks.task.create.mock.calls[0][0];
    expect(createArgs.data.goalId).toBe("goal-a");
  });

  it("abstains when sibling tasks span multiple goals", async () => {
    mocks.task.findMany
      .mockResolvedValueOnce([
        { goalId: "goal-a" },
        { goalId: "goal-b" },
        { goalId: "goal-a" },
      ])
      .mockResolvedValue([]);

    await createTask(baseInput);

    const createArgs = mocks.task.create.mock.calls[0][0];
    // No inherited goalId — payload had no goalId, so the field stays
    // unset on the create.data (Prisma will treat as null).
    expect(createArgs.data.goalId).toBeUndefined();
  });

  it("respects an explicit goalId passed by the caller", async () => {
    // Even if siblings would suggest goal-a, an explicit goal-z wins.
    // Note: when payload.goalId is set, the auto-inherit query is
    // SKIPPED — so only the syncTaskPriorities findMany call fires.
    mocks.task.findMany.mockResolvedValue([]);

    await createTask({ ...baseInput, goalId: "goal-z" });

    const createArgs = mocks.task.create.mock.calls[0][0];
    expect(createArgs.data.goalId).toBe("goal-z");
  });

  it("leaves goalId null when no siblings have a goal set", async () => {
    mocks.task.findMany.mockResolvedValue([]); // no siblings linked

    await createTask(baseInput);

    const createArgs = mocks.task.create.mock.calls[0][0];
    expect(createArgs.data.goalId).toBeUndefined();
  });
});

/**
 * Subtask hierarchy · 2026-05-23 · task #22 · ADR-0017 amended Rule 2.
 *
 * When `parentTaskId` is set on the payload AND `goalId` is not
 * explicitly set, the PARENT's goalId wins over sibling-scan
 * inheritance · the operator chose this parent, its goal context is
 * the strongest signal. Explicit `goalId` in the payload always
 * wins · operator override stays sacred.
 *
 * Branches covered here:
 *   1. parentTaskId set + parent has goalId → inherit parent's goal
 *   2. parentTaskId set + parent has no goalId → fall back to siblings
 *   3. parentTaskId set + explicit goalId in payload → respect explicit
 *   4. parentTaskId persists to create.data unchanged
 */
describe("createTask · subtask parent-inheritance (task #22)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mission.findUnique.mockResolvedValue({ id: "mission-1", deletedAt: null });
    mocks.mission.findMany.mockResolvedValue([]);
    mocks.task.create.mockImplementation(async (args: { data: { goalId?: string | null; parentTaskId?: string | null } }) => ({
      id: "new-task-id",
      ...args.data,
    }));
    mocks.task.findUnique.mockResolvedValue({
      id: "new-task-id",
      missionId: "mission-1",
      title: "new task",
      status: "INBOX",
      mission: { id: "mission-1", title: "Mission 1" },
    });
    mocks.task.update.mockResolvedValue({});
  });

  it("inherits goalId from the parent when parentTaskId is set", async () => {
    // First findUnique call is the parent lookup; subsequent findUnique
    // is the post-create hydrate. Set the parent's goalId.
    mocks.task.findUnique
      .mockResolvedValueOnce({ goalId: "parent-goal" }) // parent lookup
      .mockResolvedValue({
        id: "new-task-id",
        missionId: "mission-1",
        title: "new task",
        status: "INBOX",
        mission: { id: "mission-1", title: "Mission 1" },
      });
    // No siblings exist — parent inheritance should kick in regardless.
    mocks.task.findMany.mockResolvedValue([]);

    await createTask({ ...baseInput, parentTaskId: "parent-1" });

    const createArgs = mocks.task.create.mock.calls[0][0];
    expect(createArgs.data.goalId).toBe("parent-goal");
    expect(createArgs.data.parentTaskId).toBe("parent-1");
  });

  it("falls back to sibling-scan when the parent has no goalId", async () => {
    // Parent has null goalId — parent inheritance abstains, sibling
    // scan should then run and pick up the unanimous sibling goal.
    mocks.task.findUnique
      .mockResolvedValueOnce({ goalId: null }) // parent lookup
      .mockResolvedValue({
        id: "new-task-id",
        missionId: "mission-1",
        title: "new task",
        status: "INBOX",
        mission: { id: "mission-1", title: "Mission 1" },
      });
    mocks.task.findMany
      .mockResolvedValueOnce([{ goalId: "sibling-goal" }, { goalId: "sibling-goal" }])
      .mockResolvedValue([]);

    await createTask({ ...baseInput, parentTaskId: "parent-1" });

    const createArgs = mocks.task.create.mock.calls[0][0];
    expect(createArgs.data.goalId).toBe("sibling-goal");
    expect(createArgs.data.parentTaskId).toBe("parent-1");
  });

  it("respects explicit goalId even when parent has a different goal", async () => {
    // Parent says goal-a but operator explicitly chose goal-z · the
    // explicit choice wins · auto-inherit skipped entirely.
    mocks.task.findUnique.mockResolvedValue({
      id: "new-task-id",
      missionId: "mission-1",
      title: "new task",
      status: "INBOX",
      mission: { id: "mission-1", title: "Mission 1" },
    });
    mocks.task.findMany.mockResolvedValue([]);

    await createTask({
      ...baseInput,
      parentTaskId: "parent-1",
      goalId: "goal-z",
    });

    const createArgs = mocks.task.create.mock.calls[0][0];
    expect(createArgs.data.goalId).toBe("goal-z");
    expect(createArgs.data.parentTaskId).toBe("parent-1");
  });

  it("persists parentTaskId on the create.data even with no inheritance", async () => {
    // Parent has no goal · no siblings · no explicit · parentTaskId
    // should still land on the new row.
    mocks.task.findUnique
      .mockResolvedValueOnce({ goalId: null }) // parent lookup
      .mockResolvedValue({
        id: "new-task-id",
        missionId: "mission-1",
        title: "new task",
        status: "INBOX",
        mission: { id: "mission-1", title: "Mission 1" },
      });
    mocks.task.findMany.mockResolvedValue([]);

    await createTask({ ...baseInput, parentTaskId: "parent-1" });

    const createArgs = mocks.task.create.mock.calls[0][0];
    expect(createArgs.data.parentTaskId).toBe("parent-1");
    expect(createArgs.data.goalId).toBeUndefined();
  });
});

/**
 * Thin quick-add payload · regression cover for the 2026-05-21
 * add-task bug.
 *
 * The /tasks quick-add bar POSTs through trpc.task.create with only
 * title + missionId + a few loop fields. taskCreateSchema used to
 * require nextPhysicalAction / frictionScore / energyRequired /
 * context / finishCondition with no default, so .parse() threw a
 * ZodError inside createTask() and the operator got a "Failed to add
 * task" toast — the add path was fully broken. Those five fields now
 * default; a bare payload must create cleanly.
 */
describe("createTask · thin quick-add payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mission.findUnique.mockResolvedValue({ id: "mission-1", deletedAt: null });
    mocks.mission.findMany.mockResolvedValue([]);
    mocks.task.findMany.mockResolvedValue([]); // no siblings, no sweep
    mocks.task.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: "new-task-id",
      ...args.data,
    }));
    mocks.task.findUnique.mockResolvedValue({
      id: "new-task-id",
      missionId: "mission-1",
      title: "call the vendor",
      status: "INBOX",
      mission: { id: "mission-1", title: "Mission 1" },
    });
    mocks.task.update.mockResolvedValue({});
  });

  it("creates a task from only title + missionId", async () => {
    await expect(
      createTask({ title: "call the vendor", missionId: "mission-1" }),
    ).resolves.toBeDefined();

    const createArgs = mocks.task.create.mock.calls[0][0];
    expect(createArgs.data.title).toBe("call the vendor");
    expect(createArgs.data.effort).toBe("M15");
    expect(createArgs.data.frictionScore).toBe(50);
    expect(createArgs.data.energyRequired).toBe("MEDIUM");
    expect(createArgs.data.context).toBe("ANYWHERE");
    expect(createArgs.data.roiScore).toBe(50);
    expect(createArgs.data.finishCondition).toBe("");
  });

  // nextPhysicalAction is NOT NULL with no DB default — a bare task
  // has none, so createTask falls it back to the title rather than
  // writing an empty string.
  it("defaults nextPhysicalAction to the title when omitted", async () => {
    await createTask({ title: "call the vendor", missionId: "mission-1" });
    const createArgs = mocks.task.create.mock.calls[0][0];
    expect(createArgs.data.nextPhysicalAction).toBe("call the vendor");
  });

  it("keeps an explicit nextPhysicalAction over the title fallback", async () => {
    await createTask({
      title: "call the vendor",
      missionId: "mission-1",
      nextPhysicalAction: "dial 555-0100",
    });
    const createArgs = mocks.task.create.mock.calls[0][0];
    expect(createArgs.data.nextPhysicalAction).toBe("dial 555-0100");
  });

  // The exact field shape the /tasks quick-add bar sends.
  it("creates from the quick-add bar payload shape", async () => {
    await expect(
      createTask({
        title: "ship the redesign",
        missionId: "mission-1",
        effort: "M30",
        roiScore: 50,
        loopKind: "ONCE",
        promiseTo: null,
        dueDate: null,
      }),
    ).resolves.toBeDefined();

    const createArgs = mocks.task.create.mock.calls[0][0];
    expect(createArgs.data.title).toBe("ship the redesign");
    expect(createArgs.data.effort).toBe("M30");
    expect(createArgs.data.loopKind).toBe("ONCE");
  });
});
