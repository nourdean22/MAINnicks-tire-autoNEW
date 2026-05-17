/**
 * Unit tests for lib/brain/prediction-streaks.ts
 *
 * v8.1 · F4 · Apr 29 — pure-function streak math:
 *   · current streak counts consecutive HITs at the tail
 *   · longest streak scans the whole window
 *   · brokenJustNow fires only when latest is MISS following a HIT
 *   · sort order: brokenJustNow → currentStreak → hitRate
 *   · freshBreaks filtered to last 24h
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { prediction: { findMany: (...a: unknown[]) => mocks.findMany(...a) } },
}));

import { computePredictionStreaks } from "@/lib/brain/prediction-streaks";

const NOW = Date.now();

function row(category: string, status: string, daysAgo: number) {
  return {
    category,
    status,
    targetDate: new Date(NOW - daysAgo * 86_400_000).toISOString().slice(0, 10),
    updatedAt: new Date(NOW - daysAgo * 86_400_000),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computePredictionStreaks", () => {
  it("returns empty report when no predictions exist", async () => {
    mocks.findMany.mockResolvedValue([]);
    const r = await computePredictionStreaks();
    expect(r.byCategory).toEqual([]);
    expect(r.freshBreaks).toEqual([]);
    expect(r.topActive).toBeNull();
  });

  it("counts current streak from the tail (latest = unbroken HITs)", async () => {
    mocks.findMany.mockResolvedValue([
      row("business", "confirmed", 10),
      row("business", "disproven", 8),
      row("business", "confirmed", 6),
      row("business", "confirmed", 4),
      row("business", "confirmed", 2),
    ]);
    const r = await computePredictionStreaks();
    const biz = r.byCategory.find((c) => c.category === "business")!;
    expect(biz.currentStreak).toBe(3); // last 3 in a row are HITs
    expect(biz.longestStreak).toBe(3);
    expect(biz.totalGraded).toBe(5);
    expect(biz.hitRate).toBeCloseTo(4 / 5);
    expect(biz.brokenJustNow).toBe(false);
  });

  it("computes longest streak across the full window even when latest broke", async () => {
    mocks.findMany.mockResolvedValue([
      row("health", "confirmed", 30),
      row("health", "confirmed", 28),
      row("health", "confirmed", 26),
      row("health", "confirmed", 24),
      row("health", "confirmed", 22), // 5-streak
      row("health", "disproven", 20),
      row("health", "confirmed", 18),
      row("health", "disproven", 1), // most recent: MISS
    ]);
    const r = await computePredictionStreaks();
    const h = r.byCategory.find((c) => c.category === "health")!;
    expect(h.longestStreak).toBe(5);
    expect(h.currentStreak).toBe(0);
    expect(h.brokenJustNow).toBe(true); // last was MISS, prior was HIT
  });

  it("does NOT mark brokenJustNow when latest miss is preceded by another miss", async () => {
    mocks.findMany.mockResolvedValue([
      row("drift", "disproven", 5),
      row("drift", "disproven", 1),
    ]);
    const r = await computePredictionStreaks();
    const d = r.byCategory.find((c) => c.category === "drift")!;
    expect(d.brokenJustNow).toBe(false);
  });

  it("populates freshBreaks only when the break happened in the last 24h", async () => {
    mocks.findMany.mockResolvedValue([
      // recent break (today)
      row("business", "confirmed", 3),
      row("business", "disproven", 0),
      // old break (10 days ago, fully outside the 24h window)
      row("operational", "confirmed", 12),
      row("operational", "disproven", 10),
    ]);
    const r = await computePredictionStreaks();
    expect(r.freshBreaks.map((c) => c.category)).toEqual(["business"]);
  });

  it("sorts brokenJustNow first, then by currentStreak DESC, then hitRate DESC", async () => {
    mocks.findMany.mockResolvedValue([
      // broken — should be first
      row("a", "confirmed", 5),
      row("a", "disproven", 0),
      // big current streak
      row("b", "confirmed", 4),
      row("b", "confirmed", 2),
      row("b", "confirmed", 1),
      // smaller streak, higher hit rate
      row("c", "confirmed", 3),
    ]);
    const r = await computePredictionStreaks();
    expect(r.byCategory.map((c) => c.category)).toEqual(["a", "b", "c"]);
  });

  it("topActive is the highest-streak alive category (skipping breaks)", async () => {
    mocks.findMany.mockResolvedValue([
      row("a", "disproven", 0),
      row("b", "confirmed", 5),
      row("b", "confirmed", 3),
      row("c", "confirmed", 1),
    ]);
    const r = await computePredictionStreaks();
    expect(r.topActive?.category).toBe("b");
    expect(r.topActive?.currentStreak).toBe(2);
  });

  it("clamps windowDays at the API boundary (smoke; helper accepts any positive number)", async () => {
    mocks.findMany.mockResolvedValue([]);
    const r = await computePredictionStreaks(7);
    expect(r.computedAt).toBeDefined();
  });
});
