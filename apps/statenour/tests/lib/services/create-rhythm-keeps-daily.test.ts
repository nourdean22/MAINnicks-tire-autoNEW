/**
 * "+ rhythm" on /missions (handleAddRhythm) sends trpc.task.create {title, missionId: null, loopKind: "DAILY",
 * status: "READY", originSource}. The row that reaches Prisma must still carry loopKind DAILY and status READY:
 * the deck lists a task as a rhythm only when its loopKind is DAILY/WEEKLY, so a create path that quietly
 * dropped the field would add a one-off task that never appears in the list it was added from.
 *
 * Runs the real path trpc.task.create takes: createTaskFromAPI (inbox backfill for the missing missionId)
 * then createTask (taskCreateSchema, then the transaction), mocked at the Prisma boundary the way
 * tests/lib/services/tasks-auto-inherit.test.ts does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  mission: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  lifeGoal: { findMany: vi.fn() },
  taskClassificationCorrection: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    mission: mocks.mission,
    lifeGoal: mocks.lifeGoal,
    taskClassificationCorrection: mocks.taskClassificationCorrection,
    $transaction: vi.fn(async (fn) => fn({ task: mocks.task, mission: mocks.mission })),
  },
}));
vi.mock("@/lib/ai/classify-task-linkage", () => ({
  classifyTaskLinkage: vi.fn().mockResolvedValue({ missionId: null, goalId: null, statHints: [], confidence: 0, rationale: "", domain: null }),
}));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn(), logUpdate: vi.fn(), stripNoise: vi.fn((x) => x) }));
vi.mock("@/lib/cache/dashboard-cache", () => ({ invalidateMutationCaches: vi.fn() }));
vi.mock("@/lib/brain/task-events", () => ({ emitTaskEventAsync: vi.fn() }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn(async () => ({})) }));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));

import { createTaskFromAPI } from "@/lib/services/task-actions";

// The exact body handleAddRhythm sends (app/(mastery)/missions/hooks/use-mission-actions.ts).
const RHYTHM_BODY = () => ({
  title: "Stretch",
  missionId: null as unknown as string,
  loopKind: "DAILY",
  status: "READY",
  originSource: "missions-page:rhythm-add",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.task.updateMany.mockResolvedValue({ count: 0 });
  mocks.mission.findFirst.mockResolvedValue(null);
  // resolveInboxMissionId accepts only a live inbox: not deleted AND ACTIVE (lib/services/missions.ts).
  mocks.mission.findUnique.mockResolvedValue({ id: "m-inbox", title: "Inbox", deletedAt: null, status: "ACTIVE" });
  mocks.mission.findMany.mockResolvedValue([]);
  mocks.lifeGoal.findMany.mockResolvedValue([]);
  mocks.taskClassificationCorrection.findMany.mockResolvedValue([]);
  mocks.task.findMany.mockResolvedValue([]);
  mocks.task.update.mockResolvedValue({});
  mocks.task.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "new-task-id", ...args.data }));
  mocks.task.findUnique.mockResolvedValue({
    id: "new-task-id",
    missionId: "m-inbox",
    title: "Stretch",
    status: "READY",
    mission: { id: "m-inbox", title: "Inbox" },
  });
});

describe("trpc.task.create path · a new rhythm", () => {
  it("the row written carries loopKind DAILY and status READY, filed in the Inbox", async () => {
    await createTaskFromAPI(RHYTHM_BODY());
    expect(mocks.task.create, "the create reached Prisma").toHaveBeenCalledTimes(1);
    const data = mocks.task.create.mock.calls[0][0].data;
    expect(data.loopKind).toBe("DAILY");
    expect(data.status).toBe("READY");
    expect(data.title).toBe("Stretch");
    expect(data.missionId, "the missing missionId was backfilled, not left null").toBe("m-inbox");
  });

  it("CONTROL: without loopKind the same path writes ONCE, so the DAILY above came from the payload", async () => {
    const { loopKind: _drop, ...noLoop } = RHYTHM_BODY();
    await createTaskFromAPI(noLoop);
    expect(mocks.task.create.mock.calls[0][0].data.loopKind).toBe("ONCE");
  });
});
