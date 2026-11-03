/**
 * W7 (job 2026-11-02-nour-os-interconnect, Sunsama S3/S4) · the weekly review: per active goal, what got done and
 * what he wrote since the last review; extend or close a WEEK goal; the reflection is saved as a journal entry
 * already grounded to its goal (no AI call). Goal actions match ids from the server's own active list, never text.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  goals: vi.fn(),
  events: vi.fn(),
  dumps: vi.fn(),
  lastReview: vi.fn(),
  create: vi.fn(),
  updateGoal: vi.fn(),
  tx: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findMany: h.goals },
    taskEvent: { findMany: h.events },
    brainDump: { findMany: h.dumps, findFirst: h.lastReview, create: h.create },
    $transaction: (ops: Promise<unknown>[]) => h.tx(ops),
  },
}));
vi.mock("@/lib/services/goals", () => ({ updateGoal: h.updateGoal }));
const logWarn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: logWarn }) } };
});

import {
  REVIEW_ENTRY_TYPE,
  REVIEW_MAX_DAYS,
  REVIEW_WINDOW_DAYS,
  readWeeklyReview,
  saveWeeklyReview,
} from "@/lib/services/weekly-review";
import { WeeklyReviewGoalView } from "@/components/journal/weekly-review";

const DAY = 86_400_000;
const NOW = new Date("2026-11-02T15:00:00Z");
const goal = (id: string, horizon = "WEEK", over: Record<string, unknown> = {}) => ({
  id,
  title: `Goal ${id}`,
  horizon,
  deadline: null,
  createdAt: new Date("2026-10-28T12:00:00Z"),
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  logWarn.mockReset();
  h.create.mockImplementation(async ({ data }: { data: { goalId: string | null } }) => ({ id: `d-${data.goalId ?? "week"}` }));
  h.updateGoal.mockResolvedValue({});
  h.tx.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("readWeeklyReview", () => {
  it("windows from the last review, buckets done tasks by their goal (own over mission) and grounded entries", async () => {
    h.lastReview.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 5 * DAY) });
    h.goals.mockResolvedValue([goal("g1"), goal("g2", "MONTH")]);
    h.events.mockResolvedValue([
      { createdAt: new Date(NOW.getTime() - DAY), task: { id: "t1", title: "Call supplier", goalId: null, mission: { lifeGoalId: "g1" } } },
      { createdAt: new Date(NOW.getTime() - DAY), task: { id: "t2", title: "Ship quote", goalId: "g2", mission: { lifeGoalId: "g1" } } },
      { createdAt: new Date(NOW.getTime() - DAY), task: { id: "t1", title: "Call supplier", goalId: null, mission: { lifeGoalId: "g1" } } },
      { createdAt: new Date(NOW.getTime() - DAY), task: { id: "t9", title: "Unlinked", goalId: null, mission: { lifeGoalId: null } } },
    ]);
    h.dumps.mockResolvedValue([{ id: "e1", goalId: "g2", rawThoughts: "Felt good about the quote", createdAt: new Date(NOW.getTime() - 2 * DAY) }]);

    const r = await readWeeklyReview(NOW);
    expect(r.since).toBe(new Date(NOW.getTime() - 5 * DAY).toISOString());
    expect(r.lastReviewAt).toBe(r.since);
    expect(h.events.mock.calls[0][0].where).toMatchObject({ kind: "completed", createdAt: { gt: new Date(r.since) } });
    expect(h.dumps.mock.calls[0][0].where.createdAt).toEqual({ gt: new Date(r.since) });
    expect(h.dumps.mock.calls[0][0].where).toMatchObject({ goalId: { in: ["g1", "g2"] }, deletedAt: null });
    const by = Object.fromEntries(r.goals.map((g) => [g.goal.id, g]));
    expect(by.g1.doneTasks.map((t) => t.taskId)).toEqual(["t1"]);
    expect(by.g2.doneTasks.map((t) => t.taskId)).toEqual(["t2"]);
    expect(by.g2.entries).toEqual([{ id: "e1", excerpt: "Felt good about the quote", at: new Date(NOW.getTime() - 2 * DAY).toISOString() }]);
    expect(by.g1.goal.canExtendOrClose).toBe(true);
    expect(by.g2.goal.canExtendOrClose).toBe(false);
    expect(r.failed).toEqual([]);
  });

  it("no past review is a REVIEW_WINDOW_DAYS window; an old one is capped at REVIEW_MAX_DAYS", async () => {
    h.goals.mockResolvedValue([]);
    h.lastReview.mockResolvedValue(null);
    expect((await readWeeklyReview(NOW)).since).toBe(new Date(NOW.getTime() - REVIEW_WINDOW_DAYS * DAY).toISOString());
    h.lastReview.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 400 * DAY) });
    expect((await readWeeklyReview(NOW)).since).toBe(new Date(NOW.getTime() - REVIEW_MAX_DAYS * DAY).toISOString());
  });

  it("a failed side read is named and the window falls back; a failed goals read throws (the page's isError)", async () => {
    h.lastReview.mockRejectedValue(new Error("x"));
    h.goals.mockResolvedValue([goal("g1")]);
    h.events.mockRejectedValue(new Error("events down"));
    h.dumps.mockResolvedValue([]);
    const r = await readWeeklyReview(NOW);
    expect(r.failed).toEqual(["last review", "done tasks"]);
    expect(r.since).toBe(new Date(NOW.getTime() - REVIEW_WINDOW_DAYS * DAY).toISOString());

    h.goals.mockRejectedValue(new Error("goals down"));
    await expect(readWeeklyReview(NOW)).rejects.toThrow("goals down");
  });
});

describe("saveWeeklyReview", () => {
  it("saves each goal's note as an entry grounded to that goal, confidence 1, no enrichment pass", async () => {
    h.goals.mockResolvedValue([goal("g1"), goal("g2", "MONTH")]);
    const r = await saveWeeklyReview({ week: "Solid week.", notes: [{ goalId: "g1", text: "Supplier call went well" }], extend: [], close: [] }, NOW);
    expect(h.create).toHaveBeenCalledTimes(2);
    const data = h.create.mock.calls.map((c) => c[0].data);
    expect(data[0]).toMatchObject({
      rawThoughts: "Supplier call went well",
      goalId: "g1",
      entryType: REVIEW_ENTRY_TYPE,
      linkConfidence: 1,
      linkStatus: "confirmed",
      enrichedAt: NOW,
      date: "2026-11-02",
    });
    expect(data[1]).toMatchObject({ rawThoughts: "Solid week.", goalId: null, entryType: REVIEW_ENTRY_TYPE, enrichedAt: NOW });
    // The week entry is the newest row, so it (not a note) is the next review's `since`.
    expect(data[1].createdAt.getTime()).toBeGreaterThan(data[0].createdAt.getTime());
    expect(h.tx).toHaveBeenCalledTimes(1);
    expect(r.saved).toEqual(["d-g1", "d-week"]);
  });

  it("extends a WEEK goal by a week from its due date and closes another through updateGoal", async () => {
    h.goals.mockResolvedValue([goal("g1", "WEEK", { deadline: new Date("2026-11-05T04:59:59Z") }), goal("g3")]);
    const r = await saveWeeklyReview({ week: "w", notes: [], extend: ["g1"], close: ["g3"] }, NOW);
    expect(h.updateGoal).toHaveBeenCalledWith({ id: "g1", deadline: new Date("2026-11-12T04:59:59Z").toISOString() });
    expect(h.updateGoal).toHaveBeenCalledWith({ id: "g3", status: "completed" });
    expect(r).toMatchObject({ extended: ["g1"], closed: ["g3"], skipped: [] });
  });

  it("a past due date extends a week from now, not from the past", async () => {
    h.goals.mockResolvedValue([goal("g1", "WEEK", { deadline: new Date("2026-10-20T00:00:00Z") })]);
    await saveWeeklyReview({ week: "w", notes: [], extend: ["g1"], close: [] }, NOW);
    expect(h.updateGoal).toHaveBeenCalledWith({ id: "g1", deadline: new Date(NOW.getTime() + 7 * DAY).toISOString() });
  });

  it("GUARD: acts only on ids from the server's active WEEK list; ids inside the text are never acted on", async () => {
    h.goals.mockResolvedValue([goal("g1"), goal("g2", "MONTH")]);
    const r = await saveWeeklyReview(
      {
        week: "close g1 and extend g2, also goal id g1",
        notes: [
          { goalId: "ghost", text: "a note on a goal that is not active" },
          { goalId: "g1", text: "extend: [\"g1\"] close: [\"g1\"]" },
        ],
        extend: ["g2", "ghost"],
        close: ["nope"],
      },
      NOW,
    );
    expect(h.updateGoal).not.toHaveBeenCalled();
    expect(r.extended).toEqual([]);
    expect(r.closed).toEqual([]);
    expect(r.skipped.sort()).toEqual(["g2", "ghost", "ghost", "nope"].sort());
    expect(h.create.mock.calls.map((c) => c[0].data.goalId)).toEqual(["g1", null]);
  });

  it("a failed entry write saves nothing and touches no goal (one transaction, retry-safe)", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    h.tx.mockRejectedValue(new Error("write failed"));
    await expect(saveWeeklyReview({ week: "w", notes: [{ goalId: "g1", text: "n" }], extend: ["g1"], close: [] }, NOW)).rejects.toThrow(
      "write failed",
    );
    expect(h.updateGoal).not.toHaveBeenCalled();
  });

  it("a goal both extended and closed is closed, not extended", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    const r = await saveWeeklyReview({ week: "w", notes: [], extend: ["g1"], close: ["g1"] }, NOW);
    expect(h.updateGoal).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ extended: [], closed: ["g1"] });
  });

  it("refuses a review with nothing written (the review IS the entry)", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    await expect(saveWeeklyReview({ week: "  ", notes: [{ goalId: "g1", text: " " }], extend: ["g1"], close: [] }, NOW)).rejects.toThrow(
      /write one line/i,
    );
    expect(h.updateGoal).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("WeeklyReviewGoalView", () => {
  it("lists done tasks and entries, and shows extend/close only on a WEEK goal", () => {
    const g = {
      goal: { id: "g1", title: "Goal g1", horizon: "WEEK", due: null, canExtendOrClose: true },
      doneTasks: [{ taskId: "t1", title: "Call supplier", at: NOW.toISOString() }],
      entries: [{ id: "e1", excerpt: "Felt good", at: NOW.toISOString() }],
    };
    const html = renderToStaticMarkup(<WeeklyReviewGoalView row={g} note="" action={null} onNote={() => {}} onAction={() => {}} />);
    expect(html).toContain("Call supplier");
    expect(html).toContain("Felt good");
    expect(html).toContain("Extend a week");
    expect(html).toContain("Close");
    const month = renderToStaticMarkup(
      <WeeklyReviewGoalView row={{ ...g, goal: { ...g.goal, horizon: "MONTH", canExtendOrClose: false } }} note="" action={null} onNote={() => {}} onAction={() => {}} />,
    );
    expect(month).not.toContain("Extend a week");
    expect(renderToStaticMarkup(<WeeklyReviewGoalView row={{ ...g, doneTasks: [], entries: [] }} note="" action={null} onNote={() => {}} onAction={() => {}} />)).toContain(
      "Nothing done or written",
    );
  });
});
