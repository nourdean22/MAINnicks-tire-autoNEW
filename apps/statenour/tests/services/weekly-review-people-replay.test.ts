/**
 * W8b (item 6, audit B3/B11) · the weekly review's notes reach People (the same save-time name link the composer
 * runs), and a replayed save is honest about goal actions: the first run's outcomes were never stored, so a replay
 * says "unknown", never "not repeated" as if they had succeeded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  goals: vi.fn(),
  create: vi.fn(),
  updateGoal: vi.fn(),
  tx: vi.fn(),
  prior: vi.fn(),
  link: vi.fn(),
  refls: vi.fn(),
  dumps: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findMany: h.goals },
    taskEvent: { findMany: vi.fn(async () => []) },
    brainDump: { findMany: h.dumps, findFirst: vi.fn(async () => null), create: h.create },
    reflection: { findMany: h.refls },
    $transaction: (fn: unknown, opts: unknown) => h.tx(fn, opts),
  },
}));
vi.mock("@/lib/services/goals", () => ({ updateGoal: h.updateGoal }));
vi.mock("@/lib/services/goal-checkin", () => ({ logGoalCheckIn: vi.fn(async () => ({ logged: true })) }));
vi.mock("@/lib/services/people/journal-link", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/people/journal-link")>()),
  linkNamedPeople: h.link,
}));
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: vi.fn() }) } };
});

import { readWeeklyReview, saveWeeklyReview } from "@/lib/services/weekly-review";

const NOW = new Date("2026-11-03T15:00:00Z");
const goal = (id: string) => ({ id, title: `Goal ${id}`, horizon: "WEEK", deadline: null, createdAt: new Date("2026-10-28T12:00:00Z") });
const RID = "rev-0123456789";

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.goals.mockResolvedValue([goal("g1")]);
  h.create.mockImplementation(async ({ data }: { data: { goalId: string | null; rawThoughts: string; createdAt: Date } }) => ({ id: `d-${data.goalId ?? "week"}` }));
  h.updateGoal.mockResolvedValue({});
  h.prior.mockResolvedValue([]);
  h.tx.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({ brainDump: { findMany: h.prior, create: h.create } }));
  h.dumps.mockResolvedValue([]);
  h.refls.mockResolvedValue([]);
  h.link.mockImplementation(async (a: { rawText: string }) => ({ names: /Dania/.test(a.rawText) ? ["Dania"] : [] }));
});

describe("readWeeklyReview · reflections", () => {
  it("a reflection grounded to the goal is one of its entries, merged newest-first with the dumps; a failed read is named", async () => {
    h.dumps.mockResolvedValue([{ id: "d1", goalId: "g1", rawThoughts: "dump note", createdAt: new Date("2026-11-01T12:00:00Z") }]);
    h.refls.mockResolvedValue([{ id: "r1", goalId: "g1", insight: "**WHAT**: reflected", createdAt: new Date("2026-11-02T12:00:00Z") }]);
    const r = await readWeeklyReview(NOW);
    expect(r.goals[0].entries.map((e) => e.id)).toEqual(["r1", "d1"]);
    expect(h.refls.mock.calls[0][0].where).toMatchObject({ goalId: { in: ["g1"] }, deletedAt: null });
    h.refls.mockRejectedValue(new Error("column person_ids does not exist"));
    const f = await readWeeklyReview(NOW);
    expect(f.failed).toContain("reflections");
    expect(f.goals[0].entries.map((e) => e.id)).toEqual(["d1"]);
  });
});

describe("saveWeeklyReview · people", () => {
  it("every saved row runs the save-time name link with its own id, instant and text; the names come back", async () => {
    const r = await saveWeeklyReview(
      { reviewId: RID, week: "Saw Dania twice.", notes: [{ goalId: "g1", text: "Nothing on this one." }], extend: [], achieved: [], missed: [] },
      NOW,
    );
    expect(h.link).toHaveBeenCalledTimes(2);
    const calls = h.link.mock.calls.map((c) => c[0] as { silo: string; dumpId: string; rawText: string; createdAt: Date });
    expect(calls.map((c) => [c.silo, c.dumpId, c.rawText])).toEqual([
      ["brain_dump", "d-g1", "Nothing on this one."],
      ["brain_dump", "d-week", "Saw Dania twice."],
    ]);
    // Each row's own instant (the week entry is last, one ms later), never one shared stamp.
    expect(calls[1].createdAt.getTime()).toBe(calls[0].createdAt.getTime() + 1);
    expect(r.people).toEqual({ names: ["Dania"] });
    expect(r.goalActions).toBe("applied");
  });

  it("a chips-only review links no one: its stand-in row lists goal titles, not people he talked to", async () => {
    h.goals.mockResolvedValue([{ ...goal("g1"), title: "Call Dania back" }]);
    const r = await saveWeeklyReview({ reviewId: RID, week: "", notes: [{ goalId: "g1", text: "", health: "at_risk" }], extend: [], achieved: [], missed: [] }, NOW);
    expect(r.saved).toEqual(["d-week"]);
    expect(h.link).not.toHaveBeenCalled();
    expect(r.people).toEqual({ names: [] });
  });

  it("a failed link never fails the save: people is null (unknown), the rows are saved", async () => {
    h.link.mockRejectedValue(new Error("down"));
    const r = await saveWeeklyReview({ reviewId: RID, week: "w", notes: [], extend: [], achieved: [], missed: [] }, NOW);
    expect(r.saved).toEqual(["d-week"]);
    expect(r.people).toBeNull();
  });

  it("a replay links nothing again and says its goal actions are unknown, not 'not repeated'", async () => {
    h.prior.mockResolvedValue([{ id: "d-old1" }]);
    const r = await saveWeeklyReview({ reviewId: RID, week: "w", notes: [], extend: ["g1"], achieved: [], missed: [] }, NOW);
    expect(h.link).not.toHaveBeenCalled();
    expect(h.updateGoal).not.toHaveBeenCalled();
    expect(r).toMatchObject({ replayed: true, goalActions: "unknown", people: null });
  });
});
