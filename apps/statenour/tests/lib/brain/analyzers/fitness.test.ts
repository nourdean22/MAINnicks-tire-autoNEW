import { describe, it, expect } from "vitest";

import {
  computeFitness,
  type DailyWorkoutRow,
  type BodyWorkoutRow,
} from "@/lib/brain/analyzers/fitness";

const NOW = new Date(2026, 1, 1); // fixed — no Date.now()

function day(offset: number): Date {
  return new Date(2026, 0, 1 + offset);
}
function dayStr(offset: number): string {
  return day(offset).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function daily(offset: number, completed: boolean): DailyWorkoutRow {
  return { logDate: day(offset), workoutCompleted: completed };
}
function bodyDay(offset: number, done: boolean | null): BodyWorkoutRow {
  return { date: dayStr(offset), workoutDone: done };
}

describe("computeFitness", () => {
  it("always states it measures frequency only, not training quality", () => {
    const r = computeFitness({ daily: [], body: [], days: 30 }, NOW);
    expect(r.measures).toMatch(/frequency only/i);
    expect(r.measures).toMatch(/not.*(intensity|quality)/i);
  });

  it("returns an honest gap with zero logged days", () => {
    const r = computeFitness({ daily: [], body: [], days: 30 }, NOW);
    expect(r.fitness).toBeNull();
    expect(r.dataCompleteness.loggedDays).toBe(0);
    expect(r.dataCompleteness.note).toMatch(/no workout days logged/i);
  });

  it("flags insufficient data under 5 logged days", () => {
    const rows = [daily(0, true), daily(1, false), daily(2, true)];
    const r = computeFitness({ daily: rows, body: [], days: 30 }, NOW);
    expect(r.dataCompleteness.sufficient).toBe(false);
    expect(r.fitness).not.toBeNull();
  });

  it("computes active-day count, rate, and workouts/week", () => {
    // 8 days, 4 active -> rate 0.5, ~3.5/wk
    const pattern = [true, false, true, false, true, false, true, false];
    const rows = pattern.map((p, i) => daily(i, p));
    const r = computeFitness({ daily: rows, body: [], days: 30 }, NOW);
    expect(r.fitness?.activeDays).toBe(4);
    expect(r.fitness?.activeRate).toBe(0.5);
    expect(r.fitness?.avgWorkoutsPerWeek).toBe(3.5);
  });

  it("computes current and longest streaks", () => {
    // ...T T T F T T (ends on a 2-run); longest run = 3
    const pattern = [true, true, true, false, true, true];
    const rows = pattern.map((p, i) => daily(i, p));
    const r = computeFitness({ daily: rows, body: [], days: 30 }, NOW);
    expect(r.fitness?.longestStreak).toBe(3);
    expect(r.fitness?.currentStreak).toBe(2); // trailing T T
  });

  it("merges sources: a day is active if EITHER daily or body is true", () => {
    // daily rest on day 0, but body says workoutDone -> day 0 counts active
    const dailyRows = [daily(0, false), daily(1, false), daily(2, false), daily(3, false), daily(4, false)];
    const bodyRows = [bodyDay(0, true)];
    const r = computeFitness({ daily: dailyRows, body: bodyRows, days: 30 }, NOW);
    expect(r.dataCompleteness.loggedDays).toBe(5); // same dates, union
    expect(r.fitness?.activeDays).toBe(1); // the body-flagged day
  });

  it("detects an increasing recent-vs-prior trend", () => {
    // prior half mostly rest, recent half mostly active
    const pattern = [false, false, false, false, true, true, true, true];
    const rows = pattern.map((p, i) => daily(i, p));
    const r = computeFitness({ daily: rows, body: [], days: 30 }, NOW);
    expect(r.fitness?.trend).toBe("increasing");
  });
});
