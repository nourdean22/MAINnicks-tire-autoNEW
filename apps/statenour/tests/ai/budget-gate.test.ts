/**
 * v10.0.208 · daily-budget gate
 *
 * Pins the cache + assertWithinBudget contract so the enforcement layer
 * in aiChat() and the chat route can't silently regress to "no gate".
 *
 * Mocks prisma + settings so the test runs without a DB. The cache TTL
 * is 60s in-process; we use fake timers to advance past it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/services/settings", () => ({
  getSetting: vi.fn(async (_k: string, fallback: unknown) => fallback),
}));

const aggregateMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiGeneration: {
      aggregate: (...args: unknown[]) => aggregateMock(...args),
    },
  },
}));

import { assertWithinBudget, _resetBudgetCache } from "@/lib/ai/budget";

beforeEach(() => {
  _resetBudgetCache();
  aggregateMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("assertWithinBudget", () => {
  it("returns ok=true when spend is below the cap", async () => {
    aggregateMock.mockResolvedValue({ _sum: { costCents: 100 } });
    const result = await assertWithinBudget();
    expect(result.ok).toBe(true);
    expect(result.status.spent).toBe(100);
    expect(result.status.limit).toBe(500);
    expect(result.status.overBudget).toBe(false);
  });

  it("returns ok=false when spend reaches the cap", async () => {
    aggregateMock.mockResolvedValue({ _sum: { costCents: 500 } });
    const result = await assertWithinBudget();
    expect(result.ok).toBe(false);
    expect(result.status.overBudget).toBe(true);
  });

  it("returns ok=false when spend exceeds the cap", async () => {
    aggregateMock.mockResolvedValue({ _sum: { costCents: 750 } });
    const result = await assertWithinBudget();
    expect(result.ok).toBe(false);
    expect(result.status.spent).toBe(750);
  });

  it("caches results for 60s", async () => {
    aggregateMock.mockResolvedValue({ _sum: { costCents: 100 } });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T12:00:00Z"));

    await assertWithinBudget();
    await assertWithinBudget();
    await assertWithinBudget();
    expect(aggregateMock).toHaveBeenCalledTimes(1);

    // Advance 30s — still cached.
    vi.setSystemTime(new Date("2026-05-05T12:00:30Z"));
    await assertWithinBudget();
    expect(aggregateMock).toHaveBeenCalledTimes(1);

    // Advance past 60s — cache expires, hit DB again.
    vi.setSystemTime(new Date("2026-05-05T12:01:01Z"));
    await assertWithinBudget();
    expect(aggregateMock).toHaveBeenCalledTimes(2);
  });

  it("treats null _sum.costCents as zero spend", async () => {
    aggregateMock.mockResolvedValue({ _sum: { costCents: null } });
    const result = await assertWithinBudget();
    expect(result.ok).toBe(true);
    expect(result.status.spent).toBe(0);
  });
});
