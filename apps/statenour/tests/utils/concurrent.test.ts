/**
 * Tests for lib/utils/concurrent.ts · v10.0.201
 *
 * The sliding-window concurrency pattern shipped in v10.0.195's
 * mega-cron fix to stop the AI provider thundering herd. The
 * helper is now load-bearing for any rate-limit-sensitive fan-out
 * — needs to be tight.
 */
import { describe, it, expect, vi } from "vitest";
import { withConcurrency, withConcurrencySettled } from "@/lib/utils/concurrent";

describe("withConcurrency", () => {
  it("returns empty array for empty input", async () => {
    const r = await withConcurrency([], async () => 1, 3);
    expect(r).toEqual([]);
  });

  it("preserves item order regardless of completion order", async () => {
    const items = [10, 5, 30, 1, 20];
    const r = await withConcurrency(
      items,
      async (n) => {
        await new Promise((res) => setTimeout(res, n));
        return n * 2;
      },
      3,
    );
    expect(r).toEqual([20, 10, 60, 2, 40]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await withConcurrency(
      items,
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((res) => setTimeout(res, 5));
        active--;
      },
      4,
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // proves concurrency actually happened
  });

  it("clamps concurrency above items count", async () => {
    const r = await withConcurrency([1, 2], async (n) => n + 100, 99);
    expect(r).toEqual([101, 102]);
  });

  it("clamps concurrency below 1", async () => {
    const r = await withConcurrency([1, 2, 3], async (n) => n + 1, 0);
    expect(r).toEqual([2, 3, 4]);
  });

  it("isolates failures (other items continue)", async () => {
    const r = await withConcurrency(
      [1, 2, 3, 4, 5],
      async (n) => {
        if (n === 3) throw new Error("boom");
        return n * 10;
      },
      2,
    );
    expect(r[0]).toBe(10);
    expect(r[1]).toBe(20);
    expect(r[2]).toBeUndefined(); // failed slot
    expect(r[3]).toBe(40);
    expect(r[4]).toBe(50);
  });

  it("calls fn with item AND index", async () => {
    const fn = vi.fn(async (item: string, i: number) => `${i}:${item}`);
    const r = await withConcurrency(["a", "b", "c"], fn, 2);
    expect(r).toEqual(["0:a", "1:b", "2:c"]);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("withConcurrencySettled", () => {
  it("captures success + failure as discriminated union", async () => {
    const r = await withConcurrencySettled(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error("two failed");
        return n * 100;
      },
      2,
    );
    expect(r[0]).toEqual({ ok: true, value: 100 });
    expect(r[1].ok).toBe(false);
    if (!r[1].ok) {
      expect(r[1].error.message).toBe("two failed");
    }
    expect(r[2]).toEqual({ ok: true, value: 300 });
  });
});
