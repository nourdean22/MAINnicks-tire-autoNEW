/**
 * One workout streak (2026-10-30, home-pulse W1). The Pulse showed "BODY 1d workout streak" and
 * "YOU workout streak 8d" side by side. The 1d came from the DAILY workout task's own counter
 * (ultron-ticker); the 8d came from timelines counting COMPLETED ROWS across every DAILY habit
 * (legacy-shims synthesizes one row per habit per day), so it was neither a workout count nor a
 * day count. Prod 2026-10-30: the only live workout record was a DAILY workout task, streak 1.
 *
 * Pinned here: lib/stats/workout-streak.ts is the one producer; timelines and the ticker read it,
 * and the ticker no longer shows a second streak row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-10-30T17:40:00Z"); // 13:40 ET
const yesterday = new Date("2026-10-29T13:30:00Z");

const h = vi.hoisted(() => ({
  dailyTasks: [] as Array<{ title: string; streakCount: number; lastCompletedAt: Date | null }>,
  habitRows: [] as Array<{ habitKey: string; completed: boolean; date: string }>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findMany: vi.fn(async (args: { where?: { loopKind?: string; status?: string } }) =>
        args?.where?.loopKind === "DAILY" ? h.dailyTasks : [],
      ),
      findFirst: vi.fn(async () => h.dailyTasks[0] ?? null),
      count: vi.fn(async () => 0),
    },
    brainMemory: { findMany: vi.fn(async () => []) },
    bodyTracking: { findMany: vi.fn(async () => []) },
    financialSnapshot: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/nickstire/query", () => ({ queryNickBatch: vi.fn(), readBridge: vi.fn() }));
vi.mock("@/lib/brain/legacy-shims", () => ({
  recentDailyHabits: vi.fn(async () => h.habitRows),
}));

import { workoutStreakFrom } from "@/lib/stats/workout-streak";
import { computeInputs } from "@/lib/ultron/timelines";
import { fetchSelfMetricsTop } from "@/lib/services/ultron-ticker";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  // The prod shape: one DAILY workout task done yesterday (streak 1) beside five other daily
  // habits that each carry a long streak.
  h.dailyTasks = [
    { title: "Workout", streakCount: 1, lastCompletedAt: yesterday },
    ...["Journal", "Read", "Pray", "Water", "Stretch notes"].map((title) => ({
      title,
      streakCount: 9,
      lastCompletedAt: yesterday,
    })),
  ];
  h.habitRows = [];
  for (let d = 1; d <= 7; d++) {
    const date = new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);
    for (const t of h.dailyTasks) h.habitRows.push({ habitKey: t.title, completed: d <= t.streakCount, date });
  }
});

describe("workoutStreakFrom (the one producer)", () => {
  it("reads the workout task's counter, ignoring every other daily habit", () => {
    expect(workoutStreakFrom(h.dailyTasks, NOW)).toBe(1);
  });

  it("a streak whose last completion is older than yesterday (ET) is over: 0", () => {
    const stale = [{ title: "Gym", streakCount: 12, lastCompletedAt: new Date("2026-10-27T15:00:00Z") }];
    expect(workoutStreakFrom(stale, NOW)).toBe(0);
  });

  it("no live DAILY streak: consecutive days with a finished one-off workout task count", () => {
    const done = [new Date("2026-10-29T15:00:00Z"), new Date("2026-10-28T15:00:00Z"), new Date("2026-10-26T15:00:00Z")];
    expect(workoutStreakFrom([], NOW, done)).toBe(2);
  });

  it("control: done today keeps the streak", () => {
    const today = [{ title: "Morning workout", streakCount: 4, lastCompletedAt: new Date("2026-10-30T12:00:00Z") }];
    expect(workoutStreakFrom(today, NOW)).toBe(4);
  });
});

describe("every surface reads it", () => {
  it("timelines' workoutStreak equals the producer, not a count of habit rows", async () => {
    const inputs = await computeInputs();
    expect(inputs.workoutStreak, "the old 8d came from counting rows across all habits").toBe(1);
  });

  it("the ticker no longer emits its own BODY streak row", async () => {
    const items = await fetchSelfMetricsTop();
    expect(items.find((i) => i.id === "self-body")).toBeUndefined();
  });
});
