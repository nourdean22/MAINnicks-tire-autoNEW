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
  logGoalCheckIn: vi.fn(),
  tx: vi.fn(),
  prior: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findMany: h.goals },
    taskEvent: { findMany: h.events },
    brainDump: { findMany: h.dumps, findFirst: h.lastReview, create: h.create },
    $transaction: (fn: unknown, opts: unknown) => h.tx(fn, opts),
  },
}));
vi.mock("@/lib/services/goals", () => ({ updateGoal: h.updateGoal }));
vi.mock("@/lib/services/goal-checkin", () => ({ logGoalCheckIn: h.logGoalCheckIn }));
const logWarn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: logWarn }) } };
});

import {
  REVIEW_ENTRY_TYPE,
  REVIEW_MAX_DAYS,
  REVIEW_ROWS_CAP,
  REVIEW_WINDOW_DAYS,
  readWeeklyReview,
  saveWeeklyReview,
} from "@/lib/services/weekly-review";
import { ReviewSavedView, WeeklyReviewGoalView } from "@/components/journal/weekly-review";

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
  // The interactive transaction runs its callback against a tx client with the same brainDump mocks.
  h.prior.mockResolvedValue([]);
  h.tx.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({ brainDump: { findMany: h.prior, create: h.create } }));
});

const RID = "rev-0123456789";

describe("readWeeklyReview", () => {
  it("windows from the last review, buckets done tasks by their goal (own over mission) and grounded entries", async () => {
    h.lastReview.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 5 * DAY) });
    h.goals.mockResolvedValue([goal("g1"), goal("g2", "MONTH")]);
    h.events.mockResolvedValue([
      { createdAt: new Date(NOW.getTime() - DAY), task: { id: "t1", title: "Call supplier", goal: null, mission: { lifeGoal: { id: "g1", title: "Goal g1", deletedAt: null } } } },
      { createdAt: new Date(NOW.getTime() - DAY), task: { id: "t2", title: "Ship quote", goal: { id: "g2", title: "Goal g2", deletedAt: null }, mission: { lifeGoal: { id: "g1", title: "Goal g1", deletedAt: null } } } },
      { createdAt: new Date(NOW.getTime() - DAY), task: { id: "t1", title: "Call supplier", goal: null, mission: { lifeGoal: { id: "g1", title: "Goal g1", deletedAt: null } } } },
      { createdAt: new Date(NOW.getTime() - DAY), task: { id: "t9", title: "Unlinked", goal: null, mission: { lifeGoal: null } } },
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
    expect(r.truncated).toBe(false);
    // Only completions that can land on a reviewed goal are read, so the cap is spent on them.
    expect(h.events.mock.calls[0][0].where.task).toEqual({
      OR: [{ goalId: { in: ["g1", "g2"] } }, { goalId: null, mission: { lifeGoalId: { in: ["g1", "g2"] } } }],
    });
  });

  it("a read that fills its cap says the window is truncated", async () => {
    h.lastReview.mockResolvedValue(null);
    h.goals.mockResolvedValue([goal("g1")]);
    h.events.mockResolvedValue(
      Array.from({ length: REVIEW_ROWS_CAP }, (_, i) => ({ createdAt: NOW, task: { id: `t${i}`, title: "x", goalId: "g1", mission: null } })),
    );
    h.dumps.mockResolvedValue([]);
    expect((await readWeeklyReview(NOW)).truncated).toBe(true);
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
    const r = await saveWeeklyReview({ reviewId: RID, week: "Solid week.", notes: [{ goalId: "g1", text: "Supplier call went well" }], extend: [], achieved: [], missed: [] }, NOW);
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

  it("extends a WEEK goal by a week from its due date; Achieved and Missed set the status through updateGoal (W8a S4)", async () => {
    h.goals.mockResolvedValue([goal("g1", "WEEK", { deadline: new Date("2026-11-05T04:59:59Z") }), goal("g3"), goal("g4")]);
    const r = await saveWeeklyReview({ reviewId: RID, week: "w", notes: [], extend: ["g1"], achieved: ["g3"], missed: ["g4"] }, NOW);
    expect(h.updateGoal).toHaveBeenCalledWith({ id: "g1", deadline: new Date("2026-11-12T04:59:59Z").toISOString() });
    expect(h.updateGoal).toHaveBeenCalledWith({ id: "g3", status: "achieved" });
    expect(h.updateGoal).toHaveBeenCalledWith({ id: "g4", status: "missed" });
    expect(h.updateGoal).not.toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(r).toMatchObject({ extended: ["g1"], achieved: ["g3"], missed: ["g4"], skipped: [] });
  });

  it("W8a (S3): a grounded note with a health chip is that goal's check-in, written through the one check-in writer", async () => {
    h.goals.mockResolvedValue([goal("g1"), goal("g2")]);
    h.logGoalCheckIn.mockResolvedValue({ logged: true });
    const r = await saveWeeklyReview(
      { reviewId: RID, week: "", notes: [{ goalId: "g1", text: "Supplier call slipped", health: "at_risk" }, { goalId: "g2", text: "no chip" }], extend: [], achieved: [], missed: [] },
      NOW,
    );
    expect(h.logGoalCheckIn).toHaveBeenCalledTimes(1);
    expect(h.logGoalCheckIn).toHaveBeenCalledWith({ goalId: "g1", health: "at_risk", note: "Supplier call slipped", source: "weekly-review" });
    expect(r.checkedIn).toEqual(["g1"]);
    expect(h.create).toHaveBeenCalledTimes(2); // the entries are still journal rows
  });

  it("manager round 1 P0-1: a check-in the writer did not log ({logged:false}) is failed, never counted as logged", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    h.logGoalCheckIn.mockResolvedValue({ logged: false, eventWritten: false, valueSet: false, reason: "the check-in was not logged (db down)" });
    const r = await saveWeeklyReview({ reviewId: RID, week: "", notes: [{ goalId: "g1", text: "n", health: "on_track" }], extend: [], achieved: [], missed: [] }, NOW);
    expect(r.checkedIn).toEqual([]);
    expect(r.failed).toEqual(["g1"]);
    expect(r.alreadyCheckedIn).toEqual([]);
  });

  it("manager round 1 P0-1: a same-day duplicate is 'already checked in today', not logged and not failed", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    h.logGoalCheckIn.mockResolvedValue({ logged: false, duplicate: true, reason: "already checked in on this goal today", existing: { health: "on_track", at: NOW.toISOString() }, valueSet: false });
    const r = await saveWeeklyReview({ reviewId: RID, week: "", notes: [{ goalId: "g1", text: "n", health: "off_track" }], extend: [], achieved: [], missed: [] }, NOW);
    expect(r.checkedIn).toEqual([]);
    expect(r.failed).toEqual([]);
    expect(r.alreadyCheckedIn).toEqual(["g1"]);
  });

  it("manager round 1 P1-8: a health chip with no note still logs the check-in (empty note); its only row is the review claim", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    h.logGoalCheckIn.mockResolvedValue({ logged: true });
    const r = await saveWeeklyReview({ reviewId: RID, week: "", notes: [{ goalId: "g1", text: "  ", health: "at_risk" }], extend: [], achieved: [], missed: [] }, NOW);
    expect(h.logGoalCheckIn).toHaveBeenCalledWith({ goalId: "g1", health: "at_risk", note: "", source: "weekly-review" });
    expect(r.checkedIn).toEqual(["g1"]);
    // Round 2: one ungrounded review row is still written: it is the reviewId's claim and the next review's `since`.
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0].data).toMatchObject({ goalId: null, extractedItems: JSON.stringify({ reviewId: RID }) });
  });

  it("manager round 2: a health-only review submitted twice (lost response, phone retry) extends once; the retry is a replay", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    h.logGoalCheckIn.mockResolvedValue({ logged: true });
    const stored: { id: string; extractedItems: string }[] = [];
    h.create.mockImplementation(async ({ data }: { data: { extractedItems: string } }) => {
      const row = { id: `d-${stored.length + 1}`, extractedItems: data.extractedItems };
      stored.push(row);
      return { id: row.id };
    });
    h.prior.mockImplementation(async ({ where }: { where: { extractedItems: string } }) =>
      stored.filter((r) => r.extractedItems === where.extractedItems).map((r) => ({ id: r.id })),
    );
    const input = { reviewId: RID, week: "", notes: [{ goalId: "g1", text: "", health: "on_track" as const }], extend: ["g1"], achieved: [], missed: [] };

    const first = await saveWeeklyReview(input, NOW);
    const retry = await saveWeeklyReview(input, NOW);

    expect(first).toMatchObject({ replayed: false, extended: ["g1"], checkedIn: ["g1"] });
    expect(retry).toMatchObject({ replayed: true, extended: [], checkedIn: [], alreadyCheckedIn: [] });
    expect(h.updateGoal).toHaveBeenCalledTimes(1); // one 7-day extend, not two
    expect(h.logGoalCheckIn).toHaveBeenCalledTimes(1);
  });

  it("manager round 1 P0-1: the saved screen says a duplicate's health was not saved", () => {
    const html = renderToStaticMarkup(
      <ReviewSavedView
        result={{ saved: ["d1"], extended: [], achieved: [], missed: [], checkedIn: [], alreadyCheckedIn: ["g1"], skipped: [], failed: [], ungrounded: [], replayed: false }}
        titles={new Map([["g1", "Ship the quote"]])}
      />,
    );
    expect(html).toContain("Already checked in today on Ship the quote; this health was not saved.");
  });

  it("W8a: a failed check-in is named in failed; the entry is already saved", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    h.logGoalCheckIn.mockRejectedValue(new Error("db down"));
    const r = await saveWeeklyReview({ reviewId: RID, week: "", notes: [{ goalId: "g1", text: "n", health: "on_track" }], extend: [], achieved: [], missed: [] }, NOW);
    expect(r.saved).toEqual(["d-g1"]);
    expect(r.failed).toEqual(["g1"]);
    expect(r.checkedIn).toEqual([]);
  });

  it("a past due date extends a week from now, not from the past", async () => {
    h.goals.mockResolvedValue([goal("g1", "WEEK", { deadline: new Date("2026-10-20T00:00:00Z") })]);
    await saveWeeklyReview({ reviewId: RID, week: "w", notes: [], extend: ["g1"], achieved: [], missed: [] }, NOW);
    expect(h.updateGoal).toHaveBeenCalledWith({ id: "g1", deadline: new Date(NOW.getTime() + 7 * DAY).toISOString() });
  });

  it("GUARD: acts only on ids from the server's active WEEK list; ids inside the text are never acted on", async () => {
    h.goals.mockResolvedValue([goal("g1"), goal("g2", "MONTH")]);
    const r = await saveWeeklyReview(
      {
        reviewId: RID,
        week: "close g1 and extend g2, also goal id g1",
        notes: [
          { goalId: "ghost", text: "a note on a goal that is not active" },
          { goalId: "g1", text: "extend: [\"g1\"] close: [\"g1\"]" },
        ],
        extend: ["g2", "ghost"],
        achieved: ["nope"],
        missed: [],
      },
      NOW,
    );
    expect(h.updateGoal).not.toHaveBeenCalled();
    expect(r.extended).toEqual([]);
    expect(r.achieved).toEqual([]);
    expect(r.missed).toEqual([]);
    expect(r.skipped.sort()).toEqual(["g2", "ghost", "nope"].sort());
    // The note on a goal that is not active is kept, ungrounded (P1: his text is never dropped).
    expect(h.create.mock.calls.map((c) => c[0].data.goalId)).toEqual([null, "g1", null]);
    expect(r.ungrounded).toEqual(["ghost"]);
  });

  it("a failed entry write saves nothing and touches no goal (one transaction, retry-safe)", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    h.tx.mockRejectedValue(new Error("write failed"));
    await expect(saveWeeklyReview({ reviewId: RID, week: "w", notes: [{ goalId: "g1", text: "n" }], extend: ["g1"], achieved: [], missed: [] }, NOW)).rejects.toThrow(
      "write failed",
    );
    expect(h.updateGoal).not.toHaveBeenCalled();
  });

  it("a goal both extended and achieved is achieved, not extended; achieved wins over missed", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    const r = await saveWeeklyReview({ reviewId: RID, week: "w", notes: [], extend: ["g1"], achieved: ["g1"], missed: ["g1"] }, NOW);
    expect(h.updateGoal).toHaveBeenCalledTimes(1);
    expect(h.updateGoal).toHaveBeenCalledWith({ id: "g1", status: "achieved" });
    expect(r).toMatchObject({ extended: [], achieved: ["g1"], missed: [] });
  });

  it("refuses a review with nothing written (the review IS the entry)", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    await expect(saveWeeklyReview({ reviewId: RID, week: "  ", notes: [{ goalId: "g1", text: " " }], extend: ["g1"], achieved: [], missed: [] }, NOW)).rejects.toThrow(
      /write one line/i,
    );
    expect(h.updateGoal).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.tx).not.toHaveBeenCalled();
  });

  it("a note whose goal left the active list between read and save is saved without a goal, never dropped", async () => {
    h.goals.mockResolvedValue([]);
    const r = await saveWeeklyReview({ reviewId: RID, week: "", notes: [{ goalId: "g-closed", text: "Still my words" }], extend: [], achieved: [], missed: [] }, NOW);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0].data).toMatchObject({ rawThoughts: "Still my words", goalId: null, linkStatus: null });
    expect(r).toMatchObject({ saved: ["d-week"], ungrounded: ["g-closed"] });
  });

  it("CLAIM: the save is one serializable transaction keyed by the form's reviewId", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    await saveWeeklyReview({ reviewId: RID, week: "w", notes: [{ goalId: "g1", text: "n" }], extend: [], achieved: [], missed: [] }, NOW);
    expect(h.tx.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
    expect(h.prior.mock.calls[0][0].where).toEqual({ entryType: REVIEW_ENTRY_TYPE, extractedItems: JSON.stringify({ reviewId: RID }) });
    for (const c of h.create.mock.calls) expect(c[0].data.extractedItems).toBe(JSON.stringify({ reviewId: RID }));
  });

  it("CLAIM: a retry of a review already committed returns its rows and repeats no write and no goal action", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    h.prior.mockResolvedValue([{ id: "d-old1" }, { id: "d-old2" }]);
    const r = await saveWeeklyReview({ reviewId: RID, week: "w", notes: [{ goalId: "g1", text: "n" }], extend: ["g1"], achieved: [], missed: [] }, NOW);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.updateGoal).not.toHaveBeenCalled();
    expect(r).toMatchObject({ saved: ["d-old1", "d-old2"], replayed: true, extended: [], achieved: [], missed: [], checkedIn: [] });
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
    expect(html).toContain("Achieved");
    expect(html).toContain("Missed");
    expect(html).not.toContain(">Close<");
    // W8a (S3): a health chip per goal block; the pressed one marks the note as the goal's check-in.
    expect(html).toContain('aria-label="Health of Goal g1"');
    expect(html).toContain(">On track<");
    expect(html).toContain(">At risk<");
    expect(html).toContain(">Off track<");
    const month = renderToStaticMarkup(
      <WeeklyReviewGoalView row={{ ...g, goal: { ...g.goal, horizon: "MONTH", canExtendOrClose: false } }} note="" action={null} onNote={() => {}} onAction={() => {}} />,
    );
    expect(month).not.toContain("Extend a week");
    expect(renderToStaticMarkup(<WeeklyReviewGoalView row={{ ...g, doneTasks: [], entries: [] }} note="" action={null} onNote={() => {}} onAction={() => {}} />)).toContain(
      "Nothing done or written",
    );
  });
});

describe("weekly review states (silent-failure read)", () => {
  const g = {
    goal: { id: "g1", title: "Goal g1", horizon: "WEEK", due: null, canExtendOrClose: true },
    doneTasks: [],
    entries: [],
  };
  const view = (failed: string[]) =>
    renderToStaticMarkup(<WeeklyReviewGoalView row={g} failed={failed} note="" action={null} onNote={() => {}} onAction={() => {}} />);

  it("a failed side read is named in the goal block, never 'Nothing done or written'", () => {
    const html = view(["done tasks"]);
    expect(html).toContain("Done tasks couldn&#x27;t load");
    expect(html).not.toContain("Nothing done or written");
    expect(view(["entries"])).toContain("Entries couldn&#x27;t load");
    expect(view([])).toContain("Nothing done or written");
  });

  it("the saved screen names failed goal changes and goal-less notes by title, and says when a retry was a replay", () => {
    const titles = new Map([["g1", "Ship the quote"], ["g2", "Run the 10k"]]);
    const html = renderToStaticMarkup(
      <ReviewSavedView
        result={{ saved: ["d1"], extended: [], achieved: [], missed: [], checkedIn: [], alreadyCheckedIn: [], skipped: [], failed: ["g1"], ungrounded: ["g2"], replayed: false }}
        titles={titles}
      />,
    );
    expect(html).toContain("Ship the quote");
    expect(html).toContain("Run the 10k");
    const replay = renderToStaticMarkup(
      <ReviewSavedView result={{ saved: ["d1"], extended: [], achieved: [], missed: [], checkedIn: [], alreadyCheckedIn: [], skipped: [], failed: [], ungrounded: [], replayed: true }} titles={titles} />,
    );
    expect(replay).toContain("already saved");
  });
});

describe("saveWeeklyReview · test-analyzer gaps", () => {
  it("a goal action that throws is reported by id and logged; the entries stay saved", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    h.updateGoal.mockRejectedValueOnce(new Error("goal write failed"));
    const r = await saveWeeklyReview({ reviewId: RID, week: "w", notes: [{ goalId: "g1", text: "n" }], extend: ["g1"], achieved: [], missed: [] }, NOW);
    expect(r.failed).toEqual(["g1"]);
    expect(r.extended).toEqual([]);
    expect(r.saved).toEqual(["d-g1", "d-week"]);
    expect(h.tx).toHaveBeenCalledTimes(1);
    expect(logWarn).toHaveBeenCalledWith("review_goal_action_failed", expect.objectContaining({ goalId: "g1", err: "goal write failed" }));
  });

  it("CLAIM at the store: two saves of one reviewId write once and act once; the second returns the first's rows", async () => {
    h.goals.mockResolvedValue([goal("g1")]);
    // A store that remembers what was written, so the second call's check reads the first call's rows.
    const store: { id: string; extractedItems: string }[] = [];
    h.create.mockImplementation(async ({ data }: { data: { goalId: string | null; extractedItems: string } }) => {
      const row = { id: `d${store.length + 1}`, extractedItems: data.extractedItems };
      store.push(row);
      return { id: row.id };
    });
    h.prior.mockImplementation(async ({ where }: { where: { extractedItems: string } }) =>
      store.filter((r) => r.extractedItems === where.extractedItems).map((r) => ({ id: r.id })),
    );
    const input = { reviewId: RID, week: "w", notes: [{ goalId: "g1", text: "n" }], extend: ["g1"], achieved: [], missed: [] };
    const first = await saveWeeklyReview(input, NOW);
    const second = await saveWeeklyReview(input, NOW);
    expect(h.create).toHaveBeenCalledTimes(2);
    expect(h.updateGoal).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ saved: ["d1", "d2"], replayed: false, extended: ["g1"] });
    expect(second).toMatchObject({ saved: ["d1", "d2"], replayed: true, extended: [] });
    // A different review id is a different review.
    await saveWeeklyReview({ ...input, reviewId: "rev-other-0001" }, NOW);
    expect(h.create).toHaveBeenCalledTimes(4);
  });

  it("GUARD: Achieved / Missed never touch a goal that is active but not a WEEK goal", async () => {
    h.goals.mockResolvedValue([goal("g2", "MONTH"), goal("g3", "MONTH")]);
    const r = await saveWeeklyReview({ reviewId: RID, week: "w", notes: [], extend: [], achieved: ["g2"], missed: ["g3"] }, NOW);
    expect(h.updateGoal).not.toHaveBeenCalled();
    expect(r.skipped).toEqual(["g2", "g3"]);
  });

  it("the entry date is the ET day: at 03:00Z it is still the evening before", async () => {
    h.goals.mockResolvedValue([]);
    await saveWeeklyReview({ reviewId: RID, week: "late night", notes: [], extend: [], achieved: [], missed: [] }, new Date("2026-11-03T03:00:00Z"));
    expect(h.create.mock.calls[0][0].data.date).toBe("2026-11-02");
  });
});
