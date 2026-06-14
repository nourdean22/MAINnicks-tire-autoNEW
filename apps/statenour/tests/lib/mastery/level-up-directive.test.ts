/**
 * Level-Up Directive selector · 2026-06-10.
 *
 * Pins the deterministic ranking contract of
 * lib/mastery/level-up-directive.selectLevelUpDirective: tier order
 * (recovery → verge-goal → neglected-goal → goal-behind → body-neglect
 * → learning → closest), stable tie-breaks, the truth-hierarchy reason
 * prefix ("Because…" / "Based on…"), and the decorations (avoidance
 * mirror · milestone · build imbalance · goal bridge). Pure — zero mocks.
 */
import { describe, it, expect } from "vitest";
import {
  selectLevelUpDirective,
  computeBuildImbalance,
  isFreshDateKey,
  xpToNext,
  VERGE_PCT,
  IMBALANCE_LEVEL_GAP,
  type DirectiveStat,
  type DirectiveGoal,
} from "@/lib/mastery/level-up-directive";

const statLevel = (over: Partial<DirectiveStat> = {}): DirectiveStat => ({
  key: "technical",
  label: "Technical Craft",
  shortLabel: "Technical",
  icon: "X",
  color: "#3B82F6",
  branch: "empire",
  level: 5,
  xpIntoLevel: 10,
  xpForNext: 25,
  progressPct: 40,
  rising7dXp: 2,
  goals: [],
  ...over,
});

const goal = (over: Partial<DirectiveGoal> = {}): DirectiveGoal => ({
  id: "g1",
  title: "Ship the thing",
  status: "active",
  progress: 40,
  ...over,
});

const TODAY = "2026-06-10";

describe("selectLevelUpDirective · empty + truth hierarchy", () => {
  it("returns null when there are no stats (caller renders 'Missing data')", () => {
    expect(selectLevelUpDirective({ stats: [] })).toBeNull();
  });

  it("every tier's reason starts with Because or Based on", () => {
    // recovery
    const rec = selectLevelUpDirective({
      stats: [statLevel({ branch: "body", key: "physical" })],
      latestBody: { date: TODAY, sleepHours: 4, energy: null },
      todayKey: TODAY,
    });
    // verge-goal
    const verge = selectLevelUpDirective({
      stats: [statLevel({ progressPct: 80, goals: [{ id: "g1", title: "G" }] })],
    });
    // closest fallback
    const closest = selectLevelUpDirective({ stats: [statLevel()] });
    for (const d of [rec, verge, closest]) {
      expect(d).not.toBeNull();
      expect(d!.reason).toMatch(/^(Because|Based on)/);
    }
  });
});

describe("selectLevelUpDirective · recovery override", () => {
  const bodyStat = statLevel({
    key: "physical",
    label: "Physical Vitality",
    shortLabel: "Vitality",
    branch: "body",
    progressPct: 30,
  });
  const vergeGoalStat = statLevel({
    key: "sales",
    branch: "influence",
    progressPct: 90,
    goals: [{ id: "g1", title: "Close 10 deals" }],
  });

  it("short sleep today vetoes a verge-goal pick and prescribes recovery", () => {
    const d = selectLevelUpDirective({
      stats: [vergeGoalStat, bodyStat],
      latestBody: { date: TODAY, sleepHours: 4.5, energy: null },
      todayKey: TODAY,
    });
    expect(d!.tier).toBe("recovery");
    expect(d!.recovery).toBe(true);
    expect(d!.stat.key).toBe("physical"); // body-branch stat, not the heavy rep
    expect(d!.reason).toContain("slept 4.5h");
    expect(d!.rep.href).toBe("/stats#body");
  });

  it("energy ≤ 2 triggers it too", () => {
    const d = selectLevelUpDirective({
      stats: [vergeGoalStat, bodyStat],
      latestBody: { date: TODAY, sleepHours: null, energy: 2 },
      todayKey: TODAY,
    });
    expect(d!.tier).toBe("recovery");
    expect(d!.reason).toContain("energy 2/5");
  });

  it("a stale body log (2+ days old) does NOT trigger the override", () => {
    const d = selectLevelUpDirective({
      stats: [vergeGoalStat, bodyStat],
      latestBody: { date: "2026-06-07", sleepHours: 4, energy: 1 },
      todayKey: TODAY,
    });
    expect(d!.tier).toBe("verge-goal");
  });

  it("good sleep and energy do not trigger it", () => {
    const d = selectLevelUpDirective({
      stats: [vergeGoalStat, bodyStat],
      latestBody: { date: TODAY, sleepHours: 7.5, energy: 4 },
      todayKey: TODAY,
    });
    expect(d!.tier).toBe("verge-goal");
  });
});

describe("selectLevelUpDirective · verge-goal", () => {
  it("a goal-linked stat on the verge beats a higher-progress unlinked stat", () => {
    const unlinked = statLevel({ key: "patience", progressPct: 95, goals: [] });
    const linked = statLevel({
      key: "sales",
      progressPct: 70,
      goals: [{ id: "g1", title: "Close 10 deals" }],
    });
    const d = selectLevelUpDirective({ stats: [unlinked, linked] });
    expect(d!.tier).toBe("verge-goal");
    expect(d!.stat.key).toBe("sales");
    expect(d!.goal).toEqual({ id: "g1", title: "Close 10 deals" });
    expect(d!.reason).toContain("Close 10 deals");
  });

  it(`does not fire below the ${VERGE_PCT}% verge threshold`, () => {
    const linked = statLevel({
      key: "sales",
      progressPct: VERGE_PCT - 1,
      rising7dXp: 3, // not neglected either
      goals: [{ id: "g1", title: "G" }],
    });
    const d = selectLevelUpDirective({ stats: [linked] });
    expect(d!.tier).toBe("closest");
  });
});

describe("selectLevelUpDirective · neglected-goal (avoidance mirror)", () => {
  it("fires for a goal-linked stat with 0 XP this week", () => {
    const s = statLevel({
      key: "sales",
      progressPct: 20,
      rising7dXp: 0,
      goals: [{ id: "g1", title: "Close 10 deals" }],
    });
    const d = selectLevelUpDirective({ stats: [s] });
    expect(d!.tier).toBe("neglected-goal");
    expect(d!.neglected).toBe(true);
    expect(d!.reason).toContain("0 XP in 7 days");
  });

  it("prefers the stat more goals depend on", () => {
    const one = statLevel({
      key: "sales",
      progressPct: 50,
      rising7dXp: 0,
      goals: [{ id: "g1", title: "A" }],
    });
    const two = statLevel({
      key: "financial",
      progressPct: 10,
      rising7dXp: 0,
      goals: [
        { id: "g2", title: "B" },
        { id: "g3", title: "C" },
      ],
    });
    const d = selectLevelUpDirective({ stats: [one, two] });
    expect(d!.stat.key).toBe("financial");
  });
});

describe("selectLevelUpDirective · goal-behind", () => {
  const statA = statLevel({ key: "sales", progressPct: 30, rising7dXp: 1 });
  const statB = statLevel({ key: "financial", progressPct: 55, rising7dXp: 1 });

  it("a missed goal outranks a behind goal and targets its linked stat", () => {
    const behind = goal({
      id: "g-behind",
      title: "Behind goal",
      pace: { kind: "behind", daysBehind: 5, perDay: 1, needPerDay: 2 },
      stats: [{ statKey: "sales" }],
    });
    const missed = goal({
      id: "g-missed",
      title: "Missed goal",
      progress: 60,
      pace: { kind: "missed", overdueDays: 9 },
      stats: [{ statKey: "financial" }],
    });
    const d = selectLevelUpDirective({
      stats: [statA, statB],
      goals: [behind, missed],
    });
    expect(d!.tier).toBe("goal-behind");
    expect(d!.stat.key).toBe("financial");
    expect(d!.reason).toContain("9d past its deadline");
    expect(d!.goal!.id).toBe("g-missed");
  });

  it("skips a slipping goal whose linked stats are unknown keys", () => {
    const ghost = goal({
      id: "g-ghost",
      pace: { kind: "missed", overdueDays: 3 },
      stats: [{ statKey: "not-a-stat" }],
    });
    const d = selectLevelUpDirective({ stats: [statA], goals: [ghost] });
    expect(d!.tier).toBe("closest");
  });

  it("ignores non-active goals", () => {
    const archived = goal({
      status: "archived",
      pace: { kind: "missed", overdueDays: 3 },
      stats: [{ statKey: "sales" }],
    });
    const d = selectLevelUpDirective({ stats: [statA], goals: [archived] });
    expect(d!.tier).toBe("closest");
  });
});

describe("selectLevelUpDirective · body-neglect + learning + closest", () => {
  it("fires body-neglect when the whole Body branch took 0 XP this week", () => {
    const body1 = statLevel({ key: "physical", branch: "body", progressPct: 25, rising7dXp: 0 });
    const body2 = statLevel({ key: "mobility", branch: "body", progressPct: 45, rising7dXp: 0 });
    const mind = statLevel({ key: "mental", branch: "mind", progressPct: 50, rising7dXp: 4 });
    const d = selectLevelUpDirective({ stats: [body1, body2, mind] });
    expect(d!.tier).toBe("body-neglect");
    expect(d!.stat.key).toBe("mobility"); // highest progress in the branch
    expect(d!.rep.href).toBe("/stats#body");
  });

  it("does not fire body-neglect when any Body stat moved this week", () => {
    const body1 = statLevel({ key: "physical", branch: "body", rising7dXp: 1.5 });
    const body2 = statLevel({ key: "mobility", branch: "body", rising7dXp: 0 });
    const d = selectLevelUpDirective({ stats: [body1, body2] });
    expect(d!.tier).not.toBe("body-neglect");
  });

  it("recommends Learning when the loop is hot and nothing stronger fired", () => {
    const learning = statLevel({
      key: "learning",
      branch: "empire",
      progressPct: 10,
      rising7dXp: 3.5,
    });
    const other = statLevel({ key: "patience", branch: "mind", progressPct: 30, rising7dXp: 1 });
    const d = selectLevelUpDirective({ stats: [learning, other] });
    expect(d!.tier).toBe("learning");
    expect(d!.rep.href).toBe("/stats#learning");
    expect(d!.reason).toContain("+3.5 XP");
  });

  it("falls back to the closest level-up, linking /missions when no goal", () => {
    const a = statLevel({ key: "patience", progressPct: 35, rising7dXp: 1 });
    const b = statLevel({ key: "wisdom", progressPct: 55, rising7dXp: 1 });
    const d = selectLevelUpDirective({ stats: [a, b] });
    expect(d!.tier).toBe("closest");
    expect(d!.stat.key).toBe("wisdom");
    expect(d!.rep.href).toBe("/missions");
  });

  it("breaks exact ties by key for a stable pick", () => {
    const a = statLevel({ key: "wisdom", progressPct: 55, rising7dXp: 1 });
    const b = statLevel({ key: "patience", progressPct: 55, rising7dXp: 1 });
    const d = selectLevelUpDirective({ stats: [a, b] });
    expect(d!.stat.key).toBe("patience"); // alphabetical
  });
});

describe("selectLevelUpDirective · execution bridge (rep links)", () => {
  it("links the goal's nextMove task into /missions when known", () => {
    const s = statLevel({
      key: "sales",
      progressPct: 80,
      goals: [{ id: "g1", title: "Close 10 deals" }],
    });
    const g = goal({
      id: "g1",
      title: "Close 10 deals",
      nextMove: { id: "t42", title: "Call the 3 oldest estimates" },
    });
    const d = selectLevelUpDirective({ stats: [s], goals: [g] });
    expect(d!.rep.href).toBe("/missions?taskId=t42");
    expect(d!.rep.cta).toBe("Start this rep");
    expect(d!.rep.text).toContain("Call the 3 oldest estimates");
  });

  it("falls back to the goal-card anchor when no nextMove exists", () => {
    const s = statLevel({
      key: "sales",
      progressPct: 80,
      goals: [{ id: "g1", title: "Close 10 deals" }],
    });
    const d = selectLevelUpDirective({ stats: [s] }); // goals payload absent
    expect(d!.rep.href).toBe("/stats#goal-g1");
  });
});

describe("decorations · milestone + imbalance + xpToNext", () => {
  it("flags a milestone when the next level is a tier boundary", () => {
    const s = statLevel({ key: "sales", level: 9, progressPct: 70, goals: [{ id: "g", title: "G" }] });
    const d = selectLevelUpDirective({ stats: [s] });
    expect(d!.milestone).toEqual({ level: 10, tier: "Mastery" });
  });

  it("no milestone for an ordinary next level", () => {
    const d = selectLevelUpDirective({ stats: [statLevel({ level: 5 })] });
    expect(d!.milestone).toBeNull();
  });

  it("computeBuildImbalance speaks only when a branch clearly trails", () => {
    const clear = [
      statLevel({ key: "a", branch: "body", level: 2 }),
      statLevel({ key: "b", branch: "body", level: 2 }),
      statLevel({ key: "c", branch: "empire", level: 2 + IMBALANCE_LEVEL_GAP }),
      statLevel({ key: "d", branch: "empire", level: 2 + IMBALANCE_LEVEL_GAP }),
    ];
    expect(computeBuildImbalance(clear)).toBe("Body trailing Craft & Empire");
    const murky = [
      statLevel({ key: "a", branch: "body", level: 4 }),
      statLevel({ key: "c", branch: "empire", level: 5 }),
    ];
    expect(computeBuildImbalance(murky)).toBeNull();
    expect(computeBuildImbalance([statLevel({ branch: "body" })])).toBeNull();
  });

  it("xpToNext is the remaining span, never negative", () => {
    expect(xpToNext({ xpForNext: 25, xpIntoLevel: 10 })).toBe(15);
    expect(xpToNext({ xpForNext: 25, xpIntoLevel: 26 })).toBe(0);
  });

  it("isFreshDateKey accepts today and yesterday only", () => {
    expect(isFreshDateKey("2026-06-10", TODAY)).toBe(true);
    expect(isFreshDateKey("2026-06-09", TODAY)).toBe(true);
    expect(isFreshDateKey("2026-06-08", TODAY)).toBe(false);
    expect(isFreshDateKey("garbage", TODAY)).toBe(false);
  });
});
