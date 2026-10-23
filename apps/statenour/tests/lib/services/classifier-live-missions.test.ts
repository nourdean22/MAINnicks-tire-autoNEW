/**
 * The task classifier only offers live missions (job 2026-10-23, map F4).
 *
 * Prod 2026-10-23: 16 of 19 tasks created in 14 days were filed into a KILLED
 * mission, because enrichTaskLinkage offered every non-deleted mission with no
 * status filter. The candidate list must hold ACTIVE missions only, and a task
 * sitting in a closed mission counts as unfiled.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type M = { id: string; title: string; status: string; systemKind: string | null; domain: string; successMetric: string | null; deletedAt: Date | null };

const MISSIONS: M[] = [
  { id: "m-live", title: "Project A", status: "ACTIVE", systemKind: null, domain: "PERSONAL", successMetric: null, deletedAt: null },
  { id: "m-killed", title: "Project K", status: "KILLED", systemKind: null, domain: "PERSONAL", successMetric: null, deletedAt: null },
  { id: "m-complete", title: "Project C", status: "COMPLETE", systemKind: null, domain: "PERSONAL", successMetric: null, deletedAt: null },
  { id: "m-paused", title: "Project P", status: "PAUSED", systemKind: null, domain: "PERSONAL", successMetric: null, deletedAt: null },
  { id: "m-inbox", title: "Inbox", status: "ACTIVE", systemKind: null, domain: "PERSONAL", successMetric: null, deletedAt: null },
];

const mocks = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), updateMany: vi.fn() },
  mission: { findMany: vi.fn() },
  lifeGoal: { findMany: vi.fn() },
  taskClassificationCorrection: { findMany: vi.fn() },
  classifyTaskLinkage: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks }));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));
vi.mock("@/lib/services/missions", () => ({
  resolveInboxMissionId: vi.fn().mockResolvedValue("m-inbox"),
  resolveGeneralAnchorId: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/ai/classify-task-linkage", async (orig) => ({
  ...(await orig<object>()),
  classifyTaskLinkage: mocks.classifyTaskLinkage,
}));

import { enrichTaskLinkage } from "@/lib/services/tasks";

beforeEach(() => {
  vi.clearAllMocks();
  // Honour the where clause the way Postgres would, so the test asserts behaviour, not argument shape.
  mocks.mission.findMany.mockImplementation(async ({ where }: { where?: { status?: string; deletedAt?: null } }) =>
    MISSIONS.filter((m) => (where?.status ? m.status === where.status : true) && (where && "deletedAt" in where ? m.deletedAt === null : true)),
  );
  mocks.lifeGoal.findMany.mockResolvedValue([]);
  mocks.taskClassificationCorrection.findMany.mockResolvedValue([]);
  mocks.task.updateMany.mockResolvedValue({ count: 1 });
  mocks.classifyTaskLinkage.mockResolvedValue({ missionId: null, goalId: null, statHints: [], confidence: 0, rationale: "", domain: "personal" });
});

describe("enrichTaskLinkage · candidates are live missions only", () => {
  it("never offers a KILLED, COMPLETE or PAUSED mission to the classifier", async () => {
    mocks.task.findUnique.mockResolvedValue({ id: "t1", title: "x", nextPhysicalAction: null, missionId: "m-inbox", goalId: null, statHints: [] });
    await enrichTaskLinkage("t1");
    expect(mocks.classifyTaskLinkage).toHaveBeenCalledOnce();
    const offered = (mocks.classifyTaskLinkage.mock.calls[0][0] as { missions: Array<{ id: string }> }).missions.map((m) => m.id);
    expect(offered).toEqual(["m-live"]);
  });

  // Lens review 2026-10-23: phase progression spawns tasks into PAUSED projects on purpose;
  // a task filed in any mission that is not an inbox is a choice the classifier never clobbers.
  it("a task filed in a PAUSED mission (fully linked otherwise) is left where it is", async () => {
    mocks.task.findUnique.mockResolvedValue({ id: "t2", title: "x", nextPhysicalAction: null, missionId: "m-paused", goalId: "g1", statHints: ["s"] });
    await enrichTaskLinkage("t2");
    expect(mocks.classifyTaskLinkage).not.toHaveBeenCalled();
    expect(mocks.task.updateMany).not.toHaveBeenCalled();
  });
});
