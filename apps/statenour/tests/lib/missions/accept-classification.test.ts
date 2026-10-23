/**
 * Accepting Nick's mission suggestion never files a task into a closed
 * mission (job 2026-10-23, map F3: the one real proposal in prod targeted a
 * COMPLETE mission, and Attach did no status check).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn() },
  mission: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks }));

import { acceptTaskClassification } from "@/lib/missions/accept-classification";

const STATUS: Record<string, string> = { "m-live": "ACTIVE", "m-done": "COMPLETE" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mission.findFirst.mockImplementation(async ({ where }: { where: { id: string; status?: string; deletedAt?: null } }) =>
    STATUS[where.id] && (!where.status || STATUS[where.id] === where.status) ? { id: where.id } : null,
  );
  mocks.task.update.mockResolvedValue({});
});

describe("acceptTaskClassification", () => {
  it("refuses a target mission that is not ACTIVE and leaves the task where it is", async () => {
    mocks.task.findUnique.mockResolvedValue({ goalId: null, statHints: [], pendingClassification: { missionId: "m-done" } });
    await expect(acceptTaskClassification("t1")).rejects.toThrow(/not active/i);
    expect(mocks.task.update).not.toHaveBeenCalled();
  });

  it("attaches to a live mission and clears the suggestion", async () => {
    mocks.task.findUnique.mockResolvedValue({ goalId: null, statHints: [], pendingClassification: { missionId: "m-live" } });
    const r = await acceptTaskClassification("t1");
    expect(r).toMatchObject({ ok: true, applied: { missionId: "m-live" } });
    expect(mocks.task.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { pendingClassification: null, missionId: "m-live" } });
  });
});
