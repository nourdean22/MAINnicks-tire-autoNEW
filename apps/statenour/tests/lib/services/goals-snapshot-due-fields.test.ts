/**
 * The Home Goals card computes each goal's date with goalDue (2026-11-01 undone sweep), which needs createdAt and
 * the LATEST horizon_set. buildGoalsSnapshot now carries both. The mock ignores `include`, so the request is pinned
 * too: asc order or no take would hand the card the oldest horizon change and a date long past.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lifeGoal: { findMany: vi.fn() },
  mission: { findMany: vi.fn(async () => []) },
  masteryScore: { findMany: vi.fn(async () => []) },
  brainMemory: { findMany: vi.fn(async () => []) },
  goalEvent: { groupBy: vi.fn(async () => []) },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h }));

import { buildGoalsSnapshot } from "@/lib/services/goals-snapshot";

const goal = {
  id: "g1",
  title: "Ship the quote flow",
  domain: "business",
  horizon: "WEEK",
  metric: "steps",
  targetValue: 0,
  currentValue: 0,
  unit: "",
  progress: 0,
  status: "active",
  deadline: null,
  why: null,
  createdAt: new Date("2026-09-01T12:00:00Z"),
  updatedAt: new Date("2026-10-30T12:00:00Z"),
  _count: { tasks: 0 },
};

beforeEach(() => vi.clearAllMocks());

describe("buildGoalsSnapshot · the fields goalDue needs", () => {
  it("each row carries createdAt and the latest horizon_set time, and the read asks for the newest one", async () => {
    h.lifeGoal.findMany.mockResolvedValue([{ ...goal, events: [{ createdAt: new Date("2026-10-29T14:00:00Z") }] }]);
    const snap = await buildGoalsSnapshot();
    expect(snap.ladder.WEEK[0]).toMatchObject({ createdAt: "2026-09-01T12:00:00.000Z", horizonSetAt: "2026-10-29T14:00:00.000Z" });
    const include = h.lifeGoal.findMany.mock.calls[0][0].include;
    expect(include.events).toEqual({
      where: { kind: "horizon_set" },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { createdAt: true },
    });
  });

  it("control: a goal whose horizon was never changed reads horizonSetAt null", async () => {
    h.lifeGoal.findMany.mockResolvedValue([{ ...goal, events: [] }]);
    const snap = await buildGoalsSnapshot();
    expect(snap.ladder.WEEK[0].horizonSetAt).toBeNull();
  });
});
