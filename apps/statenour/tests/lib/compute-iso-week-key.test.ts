/**
 * v9.1.21 · Regression tests for computeIsoWeekKey.
 *
 * The v9.1.13 fix replaced an inline `setDate(d - getDay() + 1)` that
 * mixed local-time and UTC methods (Vercel runs UTC, but getDay() can
 * be off-by-one near Sunday-night ET boundaries) with a UTC-stable
 * helper. These tests pin down the boundary behavior so the bug
 * cannot reappear.
 */

import { describe, it, expect } from "vitest";
import { computeIsoWeekKey } from "@/lib/ai/context/command-center-state";

describe("v9.1.21 · computeIsoWeekKey", () => {
  it("Monday returns its own date", () => {
    // 2026-04-27 was a Monday.
    const monday = new Date(Date.UTC(2026, 3, 27, 12, 0, 0));
    expect(computeIsoWeekKey(monday)).toBe("2026-04-27");
  });

  it("Tuesday rolls back to the same week's Monday", () => {
    // 2026-04-28 was a Tuesday.
    const tue = new Date(Date.UTC(2026, 3, 28, 12, 0, 0));
    expect(computeIsoWeekKey(tue)).toBe("2026-04-27");
  });

  it("Sunday rolls back to the previous Monday (NOT forward)", () => {
    // 2026-05-03 was a Sunday. ISO weeks are Monday-anchored, so
    // Sunday belongs to the week that started on the previous
    // Monday (2026-04-27).
    const sunday = new Date(Date.UTC(2026, 4, 3, 12, 0, 0));
    expect(computeIsoWeekKey(sunday)).toBe("2026-04-27");
  });

  it("month boundary (Friday → next Monday in same week) handles correctly", () => {
    // 2026-05-01 (Friday) should still anchor to 2026-04-27.
    const friday = new Date(Date.UTC(2026, 4, 1, 12, 0, 0));
    expect(computeIsoWeekKey(friday)).toBe("2026-04-27");
  });

  it("year boundary (Wed Jan 1 2025 → previous Mon Dec 30 2024)", () => {
    // 2025-01-01 was a Wednesday.
    const wed = new Date(Date.UTC(2025, 0, 1, 12, 0, 0));
    expect(computeIsoWeekKey(wed)).toBe("2024-12-30");
  });

  it("Sunday near hour-zero UTC still rolls back, never forward", () => {
    // 2026-05-03 00:00 UTC — start of Sunday UTC. In ET this is
    // 8pm Saturday, but we anchor in UTC for stability. Should
    // still roll back to 2026-04-27 (the previous Monday).
    const sundayMidnight = new Date(Date.UTC(2026, 4, 3, 0, 0, 0));
    expect(computeIsoWeekKey(sundayMidnight)).toBe("2026-04-27");
  });

  it("returns YYYY-MM-DD format (10 chars)", () => {
    const any = new Date(Date.UTC(2026, 6, 15, 0, 0, 0));
    const key = computeIsoWeekKey(any);
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(key.length).toBe(10);
  });
});
