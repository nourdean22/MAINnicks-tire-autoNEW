/**
 * enrichTaskLinkage runs the promise link (people W0, 2026-10-30).
 *
 * link-promise.ts is tested on its own; this pins the WIRING: delete the call
 * from enrichTaskLinkage and the first case goes red (pr-test-analyzer on 3400).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), updateMany: vi.fn() },
  mission: { findMany: vi.fn() },
  lifeGoal: { findMany: vi.fn() },
  taskClassificationCorrection: { findMany: vi.fn() },
  classifyTaskLinkage: vi.fn(),
  resolve: vi.fn(),
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
vi.mock("@/lib/brain/person-profile-fuzzy", () => ({ resolvePersonByName: mocks.resolve }));

import { enrichTaskLinkage } from "@/lib/services/tasks";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mission.findMany.mockResolvedValue([]);
  mocks.lifeGoal.findMany.mockResolvedValue([]);
  mocks.taskClassificationCorrection.findMany.mockResolvedValue([]);
  mocks.task.updateMany.mockResolvedValue({ count: 1 });
  mocks.classifyTaskLinkage.mockResolvedValue({ missionId: null, goalId: null, statHints: [], confidence: 0, rationale: "", domain: "personal" });
  // One row serves both reads: the link's {personId, promiseTo} and the classifier's linkage fields.
  mocks.task.findUnique.mockResolvedValue({
    id: "t1", title: "call back", nextPhysicalAction: null, missionId: "m-live", goalId: "g1", statHints: ["s"],
    personId: null, promiseTo: "Sam",
  });
});

describe("enrichTaskLinkage links a promise task to its person", () => {
  it("an exact-named promiseTo gets its personId, compare-and-set", async () => {
    mocks.resolve.mockResolvedValue({ matched: true, matchTier: "exact", person: { id: "p1", name: "Sam" } });
    await enrichTaskLinkage("t1");
    expect(mocks.task.updateMany).toHaveBeenCalledWith({ where: { id: "t1", personId: null }, data: { personId: "p1" } });
  });

  it("POSITIVE CONTROL: no match writes no personId", async () => {
    mocks.resolve.mockResolvedValue({ matched: false, matchTier: "no_match", person: null });
    await enrichTaskLinkage("t1");
    const personWrites = mocks.task.updateMany.mock.calls.filter((c) => "personId" in (c[0].data ?? {}));
    expect(personWrites).toHaveLength(0);
  });
});
