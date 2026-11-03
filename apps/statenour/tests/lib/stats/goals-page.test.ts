/**
 * The Goals tab's pure model (job 2026-11-02-nour-os-interconnect W5): the milestone ladder from a
 * mission's plan, the hero pick, the maxim at a goal moment, the pulse line and the "moved" line.
 */
import { describe, expect, it } from "vitest";
import { goalMomentState, GOAL_MOMENT_STATES, GOAL_MOMENT_TAG, MAXIM_TEXT_MAX, maximForGoalMoment } from "@/lib/brain/goal-maxim";
import {
  etDay,
  goalsPulse,
  maximPoolWithout,
  missionPhaseLadder,
  momentInput,
  movedLine,
  pickHeroGoal,
} from "@/lib/stats/goals-page";
import { MAXIM_POOL } from "@/lib/wisdom/maxim-pool";
import type { Maxim } from "@/lib/wisdom/maxims";

const NOW = Date.parse("2026-11-02T17:00:00Z");
const DAY = 86_400_000;

type G = Parameters<typeof momentInput>[0];
const goal = (over: Partial<G> = {}): G => ({
  id: "g1",
  title: "Goal",
  progress: 20,
  status: "active",
  currentValue: 2,
  targetValue: 10,
  unit: "",
  deadline: null,
  horizon: null,
  createdAt: new Date(NOW - 10 * DAY).toISOString(),
  health: { state: "on_track", at: new Date(NOW - DAY).toISOString(), note: null },
  ...over,
});

describe("missionPhaseLadder", () => {
  const plan = { phases: [{ name: "Scope" }, { name: "Build" }, { name: "Ship" }] };

  it("marks a phase done when it has tasks and none is open, and the first not-done phase current", () => {
    const ladder = missionPhaseLadder(plan, [
      { status: "DONE", phaseName: "Scope" },
      { status: "ARCHIVED", phaseName: "Scope" },
      { status: "DONE", phaseName: "Build" },
      { status: "DOING", phaseName: "Build" },
    ]);
    expect(ladder).toEqual([
      { name: "Scope", done: true, current: false },
      { name: "Build", done: false, current: true },
      { name: "Ship", done: false, current: false },
    ]);
  });

  it("a phase with no spawned tasks is not done (phases spawn one after another)", () => {
    const ladder = missionPhaseLadder(plan, []);
    expect(ladder.map((p) => p.done)).toEqual([false, false, false]);
    expect(ladder.map((p) => p.current)).toEqual([true, false, false]);
  });

  it("every phase done leaves none current", () => {
    const ladder = missionPhaseLadder(plan, ["Scope", "Build", "Ship"].map((p) => ({ status: "DONE", phaseName: p })));
    expect(ladder.every((p) => p.done && !p.current)).toBe(true);
  });

  it("a phase whose tasks were all archived is not done (at least one DONE task)", () => {
    const ladder = missionPhaseLadder({ phases: [{ name: "Scope" }, { name: "Build" }] }, [{ status: "ARCHIVED", phaseName: "Scope" }]);
    expect(ladder[0]).toEqual({ name: "Scope", done: false, current: true });
  });

  it("a WAITING task keeps its phase open", () => {
    const ladder = missionPhaseLadder({ phases: [{ name: "Scope" }] }, [{ status: "WAITING", phaseName: "Scope" }]);
    expect(ladder[0]).toEqual({ name: "Scope", done: false, current: true });
  });

  it("unreadable plan data gives no ladder; a nameless phase is skipped", () => {
    expect(missionPhaseLadder(null, [])).toEqual([]);
    expect(missionPhaseLadder({ phases: "x" }, [])).toEqual([]);
    expect(missionPhaseLadder({ phases: [{ name: "" }, { name: "Real" }, 7] }, []).map((p) => p.name)).toEqual(["Real"]);
  });
});

describe("goalMomentState (W6 contract, via momentInput)", () => {
  const state = (over: Partial<G> = {}) => goalMomentState(momentInput(goal(over), NOW));
  it("each state, highest first", () => {
    expect(state({ status: "achieved", health: { state: "off_track", at: null, note: null } })).toBe("achieved");
    expect(state({ health: { state: "off_track", at: null, note: null } })).toBe("off_track");
    expect(state({ status: "missed" })).toBe("off_track");
    expect(state({ health: { state: "at_risk", at: null, note: null } })).toBe("at_risk");
    expect(state({ health: { state: "no_check_in", at: null, note: null } })).toBe("check_in_due");
    expect(state()).toBeNull();
  });

  it("pace counts: behind pace beats at risk, a missed deadline is off track", () => {
    // 10 of 20 days gone, 1 of 10 done: behind (0 done reads "needs N/day", not behind).
    const behind = { currentValue: 1, createdAt: new Date(NOW - 10 * DAY).toISOString(), deadline: new Date(NOW + 10 * DAY).toISOString() };
    expect(state({ ...behind, health: { state: "at_risk", at: null, note: null } })).toBe("behind_pace");
    expect(state({ currentValue: 2, deadline: new Date(NOW - 3 * DAY).toISOString() })).toBe("off_track");
  });

  it("precedence: off track beats behind pace, behind pace beats check-in due", () => {
    const behind = { currentValue: 1, createdAt: new Date(NOW - 10 * DAY).toISOString(), deadline: new Date(NOW + 10 * DAY).toISOString() };
    expect(state({ ...behind, health: { state: "off_track", at: null, note: null } })).toBe("off_track");
    expect(state({ ...behind, health: { state: "no_check_in", at: null, note: null } })).toBe("behind_pace");
  });

  it("an unknown or missing health is no moment (unknown never reads as a state)", () => {
    expect(state({ health: { state: "unknown", at: null, note: null } })).toBeNull();
    expect(state({ health: undefined })).toBeNull();
  });

  it("an active goal at 100% is not 'achieved' (status decides, same as Nick's recall)", () => {
    expect(state({ progress: 100 })).toBeNull();
  });
});

describe("maximForGoalMoment (W6 contract)", () => {
  const pool: Maxim[] = (["focus", "decisions", "timing", "learning", "people"] as const).map((t) => ({
    id: `p:${t}`,
    text: `${t} maxim`,
    source: "Test",
    ref: t,
    tags: [t],
  }));
  const pick = (over: Partial<G>, p: readonly Maxim[] = pool, day = "2026-11-02") => maximForGoalMoment(momentInput(goal(over), NOW), p, day);

  it("picks from the tag the state maps to, and says which state chose it", () => {
    expect(pick({ health: { state: "off_track", at: null, note: null } })).toEqual({ id: "p:decisions", text: "decisions maxim", origin: "Test", state: "off_track" });
    expect(pick({ health: { state: "at_risk", at: null, note: null } })?.id).toBe("p:focus");
    expect(pick({ health: { state: "no_check_in", at: null, note: null } })?.id).toBe("p:focus");
    expect(pick({ status: "achieved" })?.id).toBe("p:learning");
    expect(pick({ currentValue: 1, deadline: new Date(NOW + 10 * DAY).toISOString() })?.id).toBe("p:timing");
    expect(Object.keys(GOAL_MOMENT_TAG).sort()).toEqual([...GOAL_MOMENT_STATES].sort());
  });

  it("no moment, no maxim (the right moment only)", () => {
    expect(pick({})).toBeNull();
  });

  it("caps the text at MAXIM_TEXT_MAX", () => {
    const long = [{ id: "l:1", text: "x".repeat(MAXIM_TEXT_MAX + 40), source: "T", ref: "1", tags: ["focus"] }];
    expect(pick({ health: { state: "at_risk", at: null, note: null } }, long)?.text).toHaveLength(MAXIM_TEXT_MAX);
  });

  it("holds still all day for one goal, and two goals can differ", () => {
    const over = { health: { state: "no_check_in" as const, at: null, note: null } };
    expect(pick(over, MAXIM_POOL)?.id).toBe(pick(over, MAXIM_POOL)?.id);
    const ids = new Set(["a", "b", "c", "d", "e", "f"].map((id) => pick({ ...over, id }, MAXIM_POOL)?.id));
    expect(ids.size).toBeGreaterThan(1);
  });

  it("the board's day key is the ET date", () => {
    expect(etDay(Date.parse("2026-11-03T03:30:00Z"))).toBe("2026-11-02");
  });

  it("a maxim Nour skipped on Home is never selected; an unread skip list gives no pool", () => {
    const over = { health: { state: "at_risk" as const, at: null, note: null } };
    const focus = MAXIM_POOL.filter((m) => m.tags.includes("focus"));
    const keep = focus[focus.length - 1]!;
    const pool = maximPoolWithout(MAXIM_POOL, focus.filter((m) => m !== keep).map((m) => m.id));
    expect(pool).not.toBeNull();
    for (const id of ["a", "b", "c", "d"]) expect(pick({ ...over, id }, pool!)?.id).toBe(keep.id);
    expect(maximPoolWithout(MAXIM_POOL, null)).toBeNull();
    expect(maximPoolWithout(MAXIM_POOL, undefined)).toBeNull();
    expect(maximPoolWithout(MAXIM_POOL, [])).toHaveLength(MAXIM_POOL.length);
  });

  it("the real pool carries a maxim for every moment tag", () => {
    for (const tag of Object.values(GOAL_MOMENT_TAG)) expect(MAXIM_POOL.some((m) => m.tags.includes(tag))).toBe(true);
  });
});

describe("pickHeroGoal", () => {
  // targetValue 0 = no pace (time only), so only the date decides.
  const dated = (id: string, days: number) => goal({ id, targetValue: 0, deadline: new Date(NOW + days * DAY).toISOString() });
  const health = (state: "on_track" | "at_risk" | "off_track" | "no_check_in") => ({ state, at: null, note: null });

  it("a goal that missed its date (or is furthest behind pace) comes first, before one due soon", () => {
    const missed = goal({ id: "missed", currentValue: 2, deadline: new Date(NOW - 3 * DAY).toISOString() });
    expect(pickHeroGoal([dated("soon", 2), missed], NOW)).toMatchObject({ goal: { id: "missed" }, reason: "furthest_behind" });
  });

  it("with no goal behind, the goal due soonest wins", () => {
    expect(pickHeroGoal([dated("a", 20), dated("b", 2)], NOW)).toMatchObject({ goal: { id: "b" }, reason: "due_soonest" });
  });

  it("a date from a horizon counts: a QUARTER goal (quarter end) beats a deadline years out", () => {
    const quarter = goal({ id: "q", targetValue: 0, horizon: "QUARTER", deadline: null });
    expect(pickHeroGoal([dated("far", 900), quarter], NOW)).toMatchObject({ goal: { id: "q" }, reason: "due_soonest" });
  });

  it("ties go to the first goal in the server's order (due and behind alike)", () => {
    expect(pickHeroGoal([dated("a", 5), dated("b", 5)], NOW)?.goal.id).toBe("a");
    const past = new Date(NOW - 4 * DAY).toISOString();
    expect(pickHeroGoal([goal({ id: "a", deadline: past }), goal({ id: "b", deadline: past })], NOW)?.goal.id).toBe("a");
  });

  it("the goal furthest behind pace wins among the behind", () => {
    const a = goal({ id: "a", currentValue: 1, deadline: new Date(NOW - 2 * DAY).toISOString() });
    const b = goal({ id: "b", currentValue: 1, deadline: new Date(NOW - 9 * DAY).toISOString() });
    expect(pickHeroGoal([a, b], NOW)).toMatchObject({ goal: { id: "b" }, reason: "furthest_behind" });
  });

  it("with no date and no pace (prod 2026-11-02: 0 deadlines), health decides: off track > at risk > no check-in", () => {
    const g = (id: string, h: Parameters<typeof health>[0]) => goal({ id, targetValue: 0, health: health(h) });
    expect(pickHeroGoal([g("ok", "on_track"), g("nc", "no_check_in"), g("risk", "at_risk"), g("off", "off_track")], NOW)).toMatchObject({
      goal: { id: "off" },
      reason: "health",
      health: "off_track",
    });
    expect(pickHeroGoal([g("nc", "no_check_in"), g("risk", "at_risk")], NOW)).toMatchObject({ goal: { id: "risk" }, health: "at_risk" });
  });

  it("then the least progress; a tie keeps the server's order", () => {
    const g = (id: string, progress: number) => goal({ id, targetValue: 0, progress });
    expect(pickHeroGoal([g("a", 60), g("b", 10), g("c", 40)], NOW)).toMatchObject({ goal: { id: "b" }, reason: "least_progress" });
    expect(pickHeroGoal([g("a", 10), g("b", 10)], NOW)?.goal.id).toBe("a");
  });

  it("one goal is just that goal", () => {
    expect(pickHeroGoal([goal({ id: "x", targetValue: 0 })], NOW)).toMatchObject({ goal: { id: "x" }, reason: "only" });
  });

  it("an achieved goal does not take the hero while another is open", () => {
    const done = goal({ id: "done", progress: 100, targetValue: 0, deadline: new Date(NOW + DAY).toISOString() });
    expect(pickHeroGoal([done, goal({ id: "open", targetValue: 0 })], NOW)?.goal.id).toBe("open");
  });

  it("no goals, no hero", () => {
    expect(pickHeroGoal([], NOW)).toBeNull();
  });
});

describe("goalsPulse", () => {
  it("counts behind, off track and check-in due once each", () => {
    const p = goalsPulse(
      [
        goal({ id: "1", health: { state: "at_risk", at: null, note: null } }),
        goal({ id: "2", health: { state: "off_track", at: null, note: null } }),
        goal({ id: "3", health: { state: "no_check_in", at: null, note: null } }),
        goal({ id: "4" }),
      ],
      NOW,
    );
    expect(p).toEqual({ total: 4, behind: 1, offTrack: 1, checkInDue: 1, unknown: 0 });
  });

  it("a failed or missing health read counts as unknown, never as fine (empty-vs-error)", () => {
    const p = goalsPulse(
      [
        goal({ id: "1", health: { state: "unknown", at: null, note: null } }),
        goal({ id: "2", health: undefined }),
        goal({ id: "3" }),
      ],
      NOW,
    );
    expect(p).toEqual({ total: 3, behind: 0, offTrack: 0, checkInDue: 0, unknown: 2 });
  });
});

describe("movedLine", () => {
  it("counts ET calendar days: 10 pm activity read at 8 am the next day is 1d ago, not today", () => {
    const read = Date.parse("2026-11-02T13:00:00Z"); // 8 am ET
    const at = "2026-11-02T03:00:00.000Z"; // 10 pm ET the day before
    expect(movedLine({ since: null, total: 1, items: [{ at, kind: "task", title: "x" }], failed: [] }, read)).toBe("Moved 1d ago");
  });

  it("an item plus an unread source says the unread part", () => {
    expect(movedLine({ since: null, total: 1, items: [{ at: new Date(NOW - 3 * DAY).toISOString(), kind: "task", title: "x" }], failed: ["journal"] }, NOW)).toBe("Moved 3d ago (some sources unread)");
  });

  it("names the newest item's age", () => {
    expect(movedLine({ since: null, total: 1, items: [{ at: new Date(NOW - 3 * DAY).toISOString(), kind: "task", title: "x" }], failed: [] }, NOW)).toBe("Moved 3d ago");
    expect(movedLine({ since: null, total: 1, items: [{ at: new Date(NOW - 3_600_000).toISOString(), kind: "task", title: "x" }], failed: [] }, NOW)).toBe("Moved today");
  });

  it("nothing logged says since when; a failed source is unknown, not quiet", () => {
    expect(movedLine({ since: "2026-10-20T00:00:00.000Z", total: 0, items: [], failed: [] }, NOW)).toBe("Nothing logged since 2026-10-20");
    expect(movedLine({ since: "2026-10-20T00:00:00.000Z", total: 0, items: [], failed: ["journal"] }, NOW)).toBe("Couldn't read journal: activity unknown");
    expect(movedLine("error", NOW)).toBe("Couldn't read recent activity");
    expect(movedLine("loading", NOW)).toBe("Reading recent activity");
  });
});
