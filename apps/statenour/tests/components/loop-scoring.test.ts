/**
 * loop-scoring · the urgency ladder that orders the NOW stream.
 *
 * This logic decides what the operator sees FIRST every day and had ZERO
 * direct coverage until 2026-08-09, because it lived inside
 * `components/actions/loop-stream.tsx` — a `"use client"` component that drags
 * in trpc, sonner and a dozen hooks, none of which resolve in statenour's
 * `node` vitest environment. Extracting it made it testable; this file is the
 * reason the extraction was worth doing at all.
 *
 * These assert the RANKING INVARIANTS (what must outrank what, and why), not
 * the literal numbers — so re-tuning a weight is free, while inverting the
 * operator's priority order is loud. The one exception is the goal-pace ladder,
 * where the ORDER between the three bumps is the whole point.
 */
import { describe, it, expect } from "vitest";
import {
  scoreUrgency,
  daysUntilDeadline,
  isDoneTodayForDaily,
  EFFORT_RANK,
  STATUS_RANK,
} from "@/components/actions/loop-scoring";
import type { Task } from "@/components/actions/shared";

/** Minimal Task with only the fields the scorer reads. */
function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "t",
    status: "READY",
    loopKind: "ONCE",
    createdAt: new Date().toISOString(),
    dueDate: null,
    lastCompletedAt: null,
    autoPriority: 50,
    stale: false,
    ...over,
  } as unknown as Task;
}

const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
};

describe("daysUntilDeadline", () => {
  it("is null with no due date, 0 today, negative once overdue", () => {
    expect(daysUntilDeadline(task())).toBeNull();
    expect(daysUntilDeadline(task({ dueDate: daysFromNow(0) }))).toBe(0);
    expect(daysUntilDeadline(task({ dueDate: daysFromNow(-3) }))).toBe(-3);
    expect(daysUntilDeadline(task({ dueDate: daysFromNow(5) }))).toBe(5);
  });

  it("compares whole days, so a due-date earlier TODAY is still 0, not -1", () => {
    // Day-start comparison — an appointment at 09:00 is not "overdue" at 17:00.
    const earlierToday = new Date();
    earlierToday.setHours(0, 0, 1, 0);
    expect(daysUntilDeadline(task({ dueDate: earlierToday.toISOString() }))).toBe(0);
  });
});

describe("isDoneTodayForDaily", () => {
  it("only ever applies to DAILY loops", () => {
    const completedNow = new Date().toISOString();
    expect(isDoneTodayForDaily(task({ loopKind: "DAILY", lastCompletedAt: completedNow }))).toBe(true);
    expect(isDoneTodayForDaily(task({ loopKind: "ONCE", lastCompletedAt: completedNow }))).toBe(false);
    expect(isDoneTodayForDaily(task({ loopKind: "PROMISE", lastCompletedAt: completedNow }))).toBe(false);
  });

  it("is false when the last completion was yesterday", () => {
    expect(
      isDoneTodayForDaily(task({ loopKind: "DAILY", lastCompletedAt: daysFromNow(-1) })),
    ).toBe(false);
  });
});

describe("scoreUrgency · ranking invariants", () => {
  it("an OVERDUE promise outranks every other shape — it is the loudest thing on the page", () => {
    const overduePromise = scoreUrgency(task({ loopKind: "PROMISE", dueDate: daysFromNow(-1) }));
    const dueTodayPromise = scoreUrgency(task({ loopKind: "PROMISE", dueDate: daysFromNow(0) }));
    const pendingDaily = scoreUrgency(task({ loopKind: "DAILY" }));
    const staleOnce = scoreUrgency(task({ stale: true }));

    expect(overduePromise.overdue).toBe(true);
    expect(overduePromise.urgency).toBeGreaterThan(dueTodayPromise.urgency);
    expect(overduePromise.urgency).toBeGreaterThan(pendingDaily.urgency);
    expect(overduePromise.urgency).toBeGreaterThan(staleOnce.urgency);
  });

  it("promise urgency decays monotonically as the deadline recedes", () => {
    const at = (d: number) =>
      scoreUrgency(task({ loopKind: "PROMISE", dueDate: daysFromNow(d) })).urgency;
    // overdue > today > within 3d > within 7d > further out
    expect(at(-1)).toBeGreaterThan(at(0));
    expect(at(0)).toBeGreaterThan(at(2));
    expect(at(2)).toBeGreaterThan(at(5));
    expect(at(5)).toBeGreaterThan(at(30));
  });

  it("a DAILY already done today sinks below one still pending — visible, but at the bottom", () => {
    const done = scoreUrgency(task({ loopKind: "DAILY", lastCompletedAt: new Date().toISOString() }));
    const pending = scoreUrgency(task({ loopKind: "DAILY" }));
    expect(done.doneToday).toBe(true);
    expect(done.urgency).toBeLessThan(pending.urgency);
  });

  it("DOING lifts a task regardless of its kind", () => {
    for (const loopKind of ["ONCE", "DAILY", "PROMISE"] as const) {
      const doing = scoreUrgency(task({ loopKind, status: "DOING" })).urgency;
      const ready = scoreUrgency(task({ loopKind, status: "READY" })).urgency;
      expect(doing, `${loopKind} in DOING should outrank the same task in READY`).toBeGreaterThan(ready);
    }
  });

  it("a stale ONCE outranks a fresh low-priority ONCE", () => {
    expect(scoreUrgency(task({ stale: true })).urgency).toBeGreaterThan(
      scoreUrgency(task({ autoPriority: 90 })).urgency,
    );
  });

  it("ONCE urgency rises as autoPriority gets more urgent (lower number)", () => {
    const at = (p: number) => scoreUrgency(task({ autoPriority: p })).urgency;
    expect(at(10)).toBeGreaterThan(at(25));
    expect(at(25)).toBeGreaterThan(at(50));
    expect(at(50)).toBeGreaterThan(at(90));
  });

  it("goal-pace bumps stay ordered missed > behind > needs > on-track", () => {
    // The ORDER here is the contract — a goal that is already blown must push
    // harder than one merely at risk, or the PLAN→NOW signal inverts.
    const base = task();
    const missed = scoreUrgency(base, "missed").urgency;
    const behind = scoreUrgency(base, "behind").urgency;
    const needs = scoreUrgency(base, "needs").urgency;
    const onTrack = scoreUrgency(base, "on-track").urgency;
    const ahead = scoreUrgency(base, "ahead").urgency;

    expect(missed).toBeGreaterThan(behind);
    expect(behind).toBeGreaterThan(needs);
    expect(needs).toBeGreaterThan(onTrack);
    // "ahead" and "on-track" both add nothing — being ahead must not penalise.
    expect(ahead).toBe(onTrack);
  });

  it("an unknown goal-pace string is inert rather than throwing", () => {
    expect(scoreUrgency(task(), "something-new").urgency).toBe(scoreUrgency(task()).urgency);
    expect(scoreUrgency(task(), null).urgency).toBe(scoreUrgency(task()).urgency);
  });
});

describe("sort ladders", () => {
  it("EFFORT_RANK orders shortest-first", () => {
    expect(EFFORT_RANK.M5).toBeLessThan(EFFORT_RANK.M15);
    expect(EFFORT_RANK.M15).toBeLessThan(EFFORT_RANK.M30);
    expect(EFFORT_RANK.M30).toBeLessThan(EFFORT_RANK.H1);
    expect(EFFORT_RANK.H1).toBeLessThan(EFFORT_RANK.H2PLUS);
  });

  it("STATUS_RANK puts in-flight work first and finished work last", () => {
    expect(STATUS_RANK.DOING).toBeLessThan(STATUS_RANK.READY);
    expect(STATUS_RANK.READY).toBeLessThan(STATUS_RANK.INBOX);
    expect(STATUS_RANK.INBOX).toBeLessThan(STATUS_RANK.WAITING);
    expect(STATUS_RANK.WAITING).toBeLessThan(STATUS_RANK.DONE);
    expect(STATUS_RANK.DONE).toBeLessThan(STATUS_RANK.CANCELLED);
  });
});
