/**
 * Now-card ranking canary — the defect this workstream exists to kill.
 *
 * 2026-08-27 measurement: the open set's roiScore column is hand-assigned
 * constants (hydration hard-coded 70, customer follow-ups hard-coded 70,
 * default 50), and the surfaces that pick "what should own the operator's
 * attention" sorted by that raw column — so "Drink water — 6+ bottles"
 * outranked revenue work structurally, not accidentally.
 *
 * Positive control shape (repo rule: ship the canary, not just the control):
 * the fixture asserts BOTH directions — the new scorer puts the overdue
 * invoice first, AND the old raw-roiScore ordering would have picked the
 * habit. If someone reverts the ranking input, the second assertion is the
 * one that names the regression instead of a silent flip.
 */
import { describe, expect, it } from "vitest";

import {
  HABIT_CLASS_MULTIPLIER,
  HABIT_LOOPS,
  NOW_WEIGHTS,
  dollarAmountFromTitle,
  scoreTaskPriority,
  type RankedMissionRef,
  type TaskPriorityCandidate,
} from "@/lib/scoring/task-priority";

const NOW = new Date("2026-08-27T15:00:00Z");
const DAY = 86_400_000;
const noMissions = new Map<string, RankedMissionRef>();

/** The live hydration row, as measured in prod (roiScore 70, DAILY, touched today). */
const habit: TaskPriorityCandidate = {
  title: "Drink water — 6+ bottles",
  missionId: "m-habits",
  status: "DOING",
  roiScore: 70,
  frictionScore: 20,
  energyRequired: "LOW",
  loopKind: "DAILY",
  lastTouchedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000), // touched 2h ago
  dueDate: null,
};

/** The operator's own example: "$846 overdue 108d" — a default-roi business task. */
const invoice: TaskPriorityCandidate = {
  title: "Collect $846 — Hicks invoice",
  missionId: "m-shop",
  status: "READY",
  roiScore: 50, // the writer default — nobody hand-blessed this row
  frictionScore: 20,
  energyRequired: "MEDIUM",
  loopKind: "ONCE",
  lastTouchedAt: new Date(NOW.getTime() - 12 * DAY),
  dueDate: new Date(NOW.getTime() - 108 * DAY),
};

describe("now-card canary: overdue revenue beats a hydration habit", () => {
  it("the scorer ranks the overdue invoice above the habit", () => {
    const inv = scoreTaskPriority(invoice, noMissions, NOW);
    const hab = scoreTaskPriority(habit, noMissions, NOW);
    expect(inv.score).toBeGreaterThan(hab.score);
  });

  it("POSITIVE CONTROL: the old raw-roiScore ordering picked the habit", () => {
    // This is the measured defect, pinned: sort by the hand-assigned column
    // and hydration (70) beats the invoice (default 50).
    const oldOrder = [habit, invoice].sort((a, b) => b.roiScore - a.roiScore);
    expect(oldOrder[0].title).toContain("Drink water");
    // …and the new scorer flips that outcome. If both assertions ever agree,
    // the fixture no longer exercises the defect — rewrite it, don't delete it.
    const newOrder = [habit, invoice].sort(
      (a, b) => scoreTaskPriority(b, noMissions, NOW).score - scoreTaskPriority(a, noMissions, NOW).score,
    );
    expect(newOrder[0].title).toContain("$846");
  });

  it("the invoice wins on terms alone, not only via the habit demotion", () => {
    const invScore = scoreTaskPriority(invoice, noMissions, NOW).score;
    const habitUndemoted = Math.round(
      scoreTaskPriority({ ...habit, loopKind: "ONCE" }, noMissions, NOW).score,
    );
    expect(invScore).toBeGreaterThan(habitUndemoted);
  });

  it("explanations are one line and name the material facts", () => {
    const inv = scoreTaskPriority(invoice, noMissions, NOW);
    expect(inv.explanation).toContain("$846");
    expect(inv.explanation).toContain("overdue 108d");
    expect(inv.explanation).not.toContain("\n");

    const hab = scoreTaskPriority(habit, noMissions, NOW);
    expect(hab.explanation).toContain(`habit ×${HABIT_CLASS_MULTIPLIER}`);
  });

  it("manual override still beats the model unconditionally", () => {
    const pinned = scoreTaskPriority({ ...habit, manualPriorityOverride: 95 }, noMissions, NOW);
    expect(pinned.score).toBe(95);
    expect(pinned.manual).toBe(true);
  });

  it("weight block is complete: weights sum to 1 and habits are demoted, not erased", () => {
    const sum = Object.values(NOW_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(HABIT_CLASS_MULTIPLIER).toBeGreaterThan(0);
    expect(HABIT_CLASS_MULTIPLIER).toBeLessThan(1);
    expect(HABIT_LOOPS.has("DAILY")).toBe(true);
    expect(HABIT_LOOPS.has("WEEKLY")).toBe(true);
    expect(HABIT_LOOPS.has("ONCE")).toBe(false);
  });

  it("dollar parser: real amounts in, garbage out as 0", () => {
    expect(dollarAmountFromTitle("Collect $1,846.50 from Hicks")).toBe(1846.5);
    expect(dollarAmountFromTitle("Drink water — 6+ bottles")).toBe(0);
    expect(dollarAmountFromTitle("costs $ dollars")).toBe(0);
  });
});
