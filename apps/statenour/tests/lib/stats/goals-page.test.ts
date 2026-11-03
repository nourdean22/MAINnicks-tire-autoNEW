/**
 * The Goals tab's pure model (job 2026-11-02-nour-os-interconnect W5): the milestone ladder from a
 * mission's plan, the hero pick, the maxim at a goal moment, the pulse line and the "moved" line.
 */
import { describe, expect, it } from "vitest";
import {
  goalMoment,
  goalsPulse,
  maximForGoalMoment,
  missionPhaseLadder,
  movedLine,
  pickHeroGoal,
  MOMENT_TAG,
} from "@/lib/stats/goals-page";
import { MAXIM_POOL } from "@/lib/wisdom/maxim-pool";
import type { Maxim } from "@/lib/wisdom/maxims";

const NOW = Date.parse("2026-11-02T17:00:00Z");
const DAY = 86_400_000;

type G = Parameters<typeof goalMoment>[0];
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

describe("goalMoment", () => {
  it("each state, in priority order", () => {
    expect(goalMoment(goal({ progress: 100 }), NOW)).toBe("achieved");
    expect(goalMoment(goal({ health: { state: "off_track", at: null, note: null } }), NOW)).toBe("off_track");
    expect(goalMoment(goal({ health: { state: "at_risk", at: null, note: null } }), NOW)).toBe("behind");
    expect(goalMoment(goal({ health: { state: "no_check_in", at: null, note: null } }), NOW)).toBe("check_in_due");
    expect(goalMoment(goal(), NOW)).toBeNull();
  });

  it("pace counts: behind pace is 'behind', a missed deadline is 'off_track'", () => {
    // 10 of 20 days gone, 1 of 10 done: behind (0 done reads "needs N/day", not behind).
    const behind = goal({ currentValue: 1, createdAt: new Date(NOW - 10 * DAY).toISOString(), deadline: new Date(NOW + 10 * DAY).toISOString() });
    expect(goalMoment(behind, NOW)).toBe("behind");
    const missed = goal({ currentValue: 2, deadline: new Date(NOW - 3 * DAY).toISOString() });
    expect(goalMoment(missed, NOW)).toBe("off_track");
  });

  it("an unknown health is no moment (unknown never reads as a state)", () => {
    expect(goalMoment(goal({ health: { state: "unknown", at: null, note: null } }), NOW)).toBeNull();
    expect(goalMoment(goal({ health: undefined }), NOW)).toBeNull();
  });

  it("achieved beats off track", () => {
    expect(goalMoment(goal({ progress: 100, health: { state: "off_track", at: null, note: null } }), NOW)).toBe("achieved");
  });
});

describe("maximForGoalMoment", () => {
  const pool: Maxim[] = (["focus", "decisions", "timing", "learning", "people"] as const).map((t) => ({
    id: `p:${t}`,
    text: `${t} maxim`,
    source: "Test",
    ref: t,
    tags: [t],
  }));

  it("picks from the tag the state maps to, and says which state chose it", () => {
    const off = maximForGoalMoment(goal({ health: { state: "off_track", at: null, note: null } }), NOW, pool);
    expect(off).toMatchObject({ state: "off_track", tag: "decisions", id: "p:decisions", text: "decisions maxim" });
    expect(maximForGoalMoment(goal({ health: { state: "at_risk", at: null, note: null } }), NOW, pool)?.tag).toBe("focus");
    expect(maximForGoalMoment(goal({ health: { state: "no_check_in", at: null, note: null } }), NOW, pool)?.tag).toBe("timing");
    expect(maximForGoalMoment(goal({ progress: 100 }), NOW, pool)?.tag).toBe("learning");
  });

  it("no moment, no maxim (the right moment only)", () => {
    expect(maximForGoalMoment(goal(), NOW, pool)).toBeNull();
  });

  it("holds still all day for one goal, and two goals can differ", () => {
    const g = goal({ health: { state: "no_check_in", at: null, note: null } });
    const a = maximForGoalMoment(g, NOW, MAXIM_POOL);
    const b = maximForGoalMoment(g, NOW + 3 * 3_600_000, MAXIM_POOL);
    expect(a?.id).toBe(b?.id);
    const ids = new Set(["a", "b", "c", "d", "e", "f"].map((id) => maximForGoalMoment({ ...g, id }, NOW, MAXIM_POOL)?.id));
    expect(ids.size).toBeGreaterThan(1);
  });

  it("the real pool carries a maxim for every moment tag", () => {
    for (const tag of Object.values(MOMENT_TAG)) expect(MAXIM_POOL.some((m) => m.tags.includes(tag))).toBe(true);
  });
});

describe("pickHeroGoal", () => {
  it("the goal due soonest wins", () => {
    const a = goal({ id: "a", deadline: new Date(NOW + 20 * DAY).toISOString() });
    const b = goal({ id: "b", deadline: new Date(NOW + 2 * DAY).toISOString() });
    expect(pickHeroGoal([a, b], NOW)).toMatchObject({ goal: { id: "b" }, reason: "due_soonest" });
  });

  it("with no upcoming date, the goal furthest behind pace wins", () => {
    const a = goal({ id: "a", currentValue: 1, deadline: new Date(NOW - 2 * DAY).toISOString() });
    const b = goal({ id: "b", currentValue: 1, deadline: new Date(NOW - 9 * DAY).toISOString() });
    expect(pickHeroGoal([a, b], NOW)).toMatchObject({ goal: { id: "b" }, reason: "furthest_behind" });
  });

  it("with no date and no pace, the first goal in the list (the server's order)", () => {
    expect(pickHeroGoal([goal({ id: "x" }), goal({ id: "y" })], NOW)).toMatchObject({ goal: { id: "x" }, reason: "first" });
  });

  it("an achieved goal does not take the hero while another is open", () => {
    const done = goal({ id: "done", progress: 100, deadline: new Date(NOW + DAY).toISOString() });
    expect(pickHeroGoal([done, goal({ id: "open" })], NOW)?.goal.id).toBe("open");
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
    expect(p).toEqual({ total: 4, behind: 1, offTrack: 1, checkInDue: 1 });
  });
});

describe("movedLine", () => {
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
