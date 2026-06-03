/**
 * tests/lib/services/operator-state.test.ts · task #22 step 5.3.
 *
 * Pure-helper test for the explicit operator-state model. The
 * top-level currentOperatorState() does 3 Prisma queries · the
 * value of unit-testing it directly is low (would mostly mock
 * Prisma). The components (focus · capacity · drift · momentum ·
 * mood inference) are pure functions · unit-testable with no DB.
 *
 * 5 component test groups + 1 integration smoke test (with mocked
 * Prisma · just confirms the 3 queries fire + shape is sane).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  computeFocus,
  computeCapacity,
  computeDrift,
  computeMomentum,
  inferMood,
  chooseLanding,
} from "@/lib/services/operator-state";

// ── computeFocus ───────────────────────────────────────────────

describe("computeFocus · completion rate over recent activity", () => {
  it("returns 1.0 when every event is a completion", () => {
    const events = [
      { kind: "completed" },
      { kind: "completed" },
      { kind: "checked" },
    ];
    expect(computeFocus(events)).toBe(1);
  });

  it("returns 0 when every event is a start (lots open, none closed)", () => {
    const events = [
      { kind: "started" },
      { kind: "started" },
      { kind: "started" },
    ];
    expect(computeFocus(events)).toBe(0);
  });

  it("returns 0.5 (neutral) when there is no activity at all", () => {
    expect(computeFocus([])).toBe(0.5);
  });

  it("computes the ratio correctly for mixed activity", () => {
    // 2 completes + 2 starts = 4 total · 2/4 = 0.5
    const events = [
      { kind: "completed" },
      { kind: "started" },
      { kind: "completed" },
      { kind: "started" },
    ];
    expect(computeFocus(events)).toBe(0.5);
  });

  it("ignores unknown event kinds", () => {
    const events = [
      { kind: "completed" },
      { kind: "edited" }, // unknown · should not count
      { kind: "started" },
    ];
    // 1 completion · 1 start · 1/(1+1) = 0.5
    expect(computeFocus(events)).toBe(0.5);
  });
});

// ── computeCapacity ────────────────────────────────────────────

describe("computeCapacity · remaining vs baseline", () => {
  it("returns 0 when today already matches the baseline (saturated)", () => {
    expect(
      computeCapacity({ todayCompletions: 5, baselineCompletions: 5 }),
    ).toBe(0);
  });

  it("returns 0 when today exceeds the baseline (still saturated)", () => {
    expect(
      computeCapacity({ todayCompletions: 10, baselineCompletions: 5 }),
    ).toBe(0);
  });

  it("returns 1.0 when today is zero against a non-zero baseline (full capacity)", () => {
    expect(
      computeCapacity({ todayCompletions: 0, baselineCompletions: 5 }),
    ).toBe(1);
  });

  it("returns the linear fraction in between", () => {
    // today=2 · baseline=5 · ratio=0.4 · capacity=0.6
    expect(
      computeCapacity({ todayCompletions: 2, baselineCompletions: 5 }),
    ).toBeCloseTo(0.6);
  });

  it("returns 0.5 (neutral) when baseline is zero · no history yet", () => {
    expect(
      computeCapacity({ todayCompletions: 5, baselineCompletions: 0 }),
    ).toBe(0.5);
  });
});

// ── computeDrift ───────────────────────────────────────────────

describe("computeDrift · open DOING vs recent completions", () => {
  it("returns 0 when there are zero DOING tasks", () => {
    expect(
      computeDrift({ openDoingCount: 0, recentCompletions: 5 }),
    ).toBe(0);
  });

  it("returns 1.0 when many DOING tasks linger with no recent completions", () => {
    // 5 doing · 0 completions · ratio = 5/1 = 5 → clamped to 1
    expect(
      computeDrift({ openDoingCount: 5, recentCompletions: 0 }),
    ).toBe(1);
  });

  it("returns a moderate value when DOING balances completions", () => {
    // 1 doing · 2 completions · ratio = 1/2 = 0.5
    expect(
      computeDrift({ openDoingCount: 1, recentCompletions: 2 }),
    ).toBe(0.5);
  });

  it("clamps to 1 when openDoing far exceeds completions", () => {
    expect(
      computeDrift({ openDoingCount: 20, recentCompletions: 1 }),
    ).toBe(1);
  });
});

// ── computeMomentum ────────────────────────────────────────────

describe("computeMomentum · 7d slope normalized", () => {
  it("returns 0.5 (flat) when input is too sparse", () => {
    expect(computeMomentum([1, 2])).toBe(0.5);
    expect(computeMomentum([])).toBe(0.5);
  });

  it("returns 0.5 when all values are zero (no signal)", () => {
    expect(computeMomentum([0, 0, 0, 0, 0, 0, 0])).toBe(0.5);
  });

  it("returns > 0.5 when later days complete more than earlier (rising)", () => {
    // First 3 avg = 1 · last 3 avg = 5 · ratio = 5 · log10(5) ≈ 0.7 ·
    // 0.5 + 0.35 = 0.85 (clamped to 1 in some cases)
    const m = computeMomentum([1, 1, 1, 3, 5, 5, 5]);
    expect(m).toBeGreaterThan(0.5);
  });

  it("returns < 0.5 when later days complete less than earlier (falling)", () => {
    // First 3 avg = 5 · last 3 avg = 1 · ratio = 0.2 · log10(0.2) ≈ -0.7
    // 0.5 - 0.35 = 0.15
    const m = computeMomentum([5, 5, 5, 3, 1, 1, 1]);
    expect(m).toBeLessThan(0.5);
  });

  it("returns 1.0 when starting from nothing", () => {
    // First 3 avg = 0 · last 3 has activity · max rise
    expect(computeMomentum([0, 0, 0, 1, 2, 3, 4])).toBe(1);
  });
});

// ── inferMood ───────────────────────────────────────────────────

describe("inferMood · qualitative tag from numeric dimensions", () => {
  it("returns 'scattered' when drift is high", () => {
    expect(
      inferMood({ focus: 0.9, capacity: 0.9, drift: 0.7, momentum: 0.9 }),
    ).toBe("scattered");
  });

  it("scattered wins over energized even when other dims are high", () => {
    // High focus + momentum would normally mean energized · but high
    // drift overrides · the operator is doing lots without finishing.
    expect(
      inferMood({ focus: 1, capacity: 1, drift: 0.6, momentum: 1 }),
    ).toBe("scattered");
  });

  it("returns 'depleted' when capacity is low (and drift is low)", () => {
    expect(
      inferMood({ focus: 0.5, capacity: 0.1, drift: 0.1, momentum: 0.5 }),
    ).toBe("depleted");
  });

  it("returns 'energized' when both focus and momentum are high", () => {
    expect(
      inferMood({ focus: 0.7, capacity: 0.7, drift: 0.2, momentum: 0.6 }),
    ).toBe("energized");
  });

  it("returns 'neutral' as the fallback when no dimension is extreme", () => {
    expect(
      inferMood({ focus: 0.5, capacity: 0.5, drift: 0.3, momentum: 0.4 }),
    ).toBe("neutral");
  });

  it("depleted wins over energized when capacity is very low", () => {
    expect(
      inferMood({ focus: 0.9, capacity: 0.1, drift: 0.2, momentum: 0.8 }),
    ).toBe("depleted");
  });
});

// ── Integration smoke (mocked Prisma) ──────────────────────────

describe("currentOperatorState · integration smoke", () => {
  const mocks = vi.hoisted(() => ({
    taskEvent: { findMany: vi.fn() },
    task: { count: vi.fn() },
  }));

  vi.mock("@/lib/prisma", () => ({
    prisma: {
      taskEvent: mocks.taskEvent,
      task: mocks.task,
    },
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a well-shaped snapshot with all 5 dimensions present", async () => {
    // Empty data · should return neutral defaults across the board.
    mocks.taskEvent.findMany.mockResolvedValue([]);
    mocks.task.count.mockResolvedValue(0);

    const { currentOperatorState } = await import(
      "@/lib/services/operator-state"
    );
    const state = await currentOperatorState(new Date("2026-05-23T18:00:00Z"));

    expect(state.ranAt).toBe("2026-05-23T18:00:00.000Z");
    expect(state.focus).toBeGreaterThanOrEqual(0);
    expect(state.focus).toBeLessThanOrEqual(1);
    expect(state.capacity).toBeGreaterThanOrEqual(0);
    expect(state.capacity).toBeLessThanOrEqual(1);
    expect(state.drift).toBeGreaterThanOrEqual(0);
    expect(state.drift).toBeLessThanOrEqual(1);
    expect(state.momentum).toBeGreaterThanOrEqual(0);
    expect(state.momentum).toBeLessThanOrEqual(1);
    expect(["energized", "neutral", "depleted", "scattered"]).toContain(
      state.mood,
    );
    expect(state.confidence).toBe(0); // no data → 0 confidence
    expect(state.signals.length).toBeGreaterThan(0);
  });

  it("never throws on Prisma errors (degrades to defaults)", async () => {
    mocks.taskEvent.findMany.mockRejectedValue(new Error("db down"));
    mocks.task.count.mockRejectedValue(new Error("db down"));

    const { currentOperatorState } = await import(
      "@/lib/services/operator-state"
    );
    const state = await currentOperatorState(new Date("2026-05-23T18:00:00Z"));

    // Should not throw · degraded snapshot returned
    expect(state.mood).toBeDefined();
    expect(state.confidence).toBe(0);
  });
});

// ── chooseLanding · Wave W Phase 3 · landing-surface recommendation ──

describe("chooseLanding · 2026-05-24 Wave W Phase 3", () => {
  const base = {
    focus: 0.5,
    capacity: 0.5,
    drift: 0.3,
    momentum: 0.5,
    mood: "neutral" as const,
    confidence: 0.7,
  };

  it("returns null when confidence is too low to recommend", () => {
    expect(chooseLanding({ ...base, confidence: 0.1 })).toBeNull();
  });

  it("recommends /system when drift is high (scattered)", () => {
    const rec = chooseLanding({ ...base, drift: 0.7, mood: "scattered" });
    expect(rec?.surface).toBe("/system");
    expect(rec?.reason).toMatch(/drift/);
  });

  it("recommends /journal when capacity is depleted", () => {
    const rec = chooseLanding({ ...base, capacity: 0.2, mood: "depleted" });
    expect(rec?.surface).toBe("/journal");
    expect(rec?.reason).toMatch(/capacity|reflect/);
  });

  it("recommends /missions when energized + momentum", () => {
    const rec = chooseLanding({
      ...base,
      focus: 0.7,
      momentum: 0.6,
      mood: "energized",
    });
    expect(rec?.surface).toBe("/missions");
    expect(rec?.reason).toMatch(/momentum|wave/);
  });

  it("recommends /brain/board on low-focus high-capacity (strategy time)", () => {
    const rec = chooseLanding({ ...base, focus: 0.2, capacity: 0.7 });
    expect(rec?.surface).toBe("/brain/board");
    expect(rec?.reason).toMatch(/board|focus/);
  });

  it("returns null for neutral steady-state (no specific signal)", () => {
    // Default base · no rule hits · null fallback by design.
    expect(chooseLanding(base)).toBeNull();
  });

  it("priority order · drift wins over depletion", () => {
    // Both drift AND low capacity · drift triggers first (system over
    // journal). Per the docstring: rule ordering is intentional.
    const rec = chooseLanding({
      ...base,
      drift: 0.7,
      capacity: 0.2,
      mood: "scattered",
    });
    expect(rec?.surface).toBe("/system");
  });
});
