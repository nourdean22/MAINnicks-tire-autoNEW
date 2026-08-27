/**
 * tests/lib/camera-intelligence.test.ts — the two read-path denominators.
 *
 * Positive controls: reintroducing either audited defect turns a test red —
 *  · bucketing days on the server's UTC calendar (a 23:00 ET event belongs
 *    to the ET day it happened on) breaks the boundary case;
 *  · dividing by the calendar 7, or letting an activity window outrun the
 *    elapsed-hours denominator past 100%, breaks the arithmetic cases.
 *
 * The module's side-effect imports are stubbed so the pure exports can be
 * exercised without a database.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: {} }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));

import {
  avgDailyOverActiveDays,
  utilizationPct,
} from "@/lib/brain/camera-intelligence";

describe("avgDailyOverActiveDays", () => {
  it("buckets by ET day: 03:00Z belongs to the previous ET evening", () => {
    // 2026-08-27T03:00:00Z = 2026-08-26 23:00 ET (EDT, UTC-4) — one ET day
    // together with the 14:00 ET event, two days on the UTC calendar.
    const ts = [
      new Date("2026-08-27T03:00:00Z"),
      new Date("2026-08-26T18:00:00Z"),
    ];
    expect(avgDailyOverActiveDays(ts)).toEqual({ activeDays: 1, avg: 2 });
  });

  it("divides by active days, never the calendar week", () => {
    // 8 events on 2 distinct ET days -> 4/day. The old /7 published 1.
    const ts = [
      ...Array.from({ length: 5 }, () => new Date("2026-08-24T15:00:00Z")),
      ...Array.from({ length: 3 }, () => new Date("2026-08-20T15:00:00Z")),
    ];
    expect(avgDailyOverActiveDays(ts)).toEqual({ activeDays: 2, avg: 4 });
  });

  it("zero events is UNMEASURED (0/0 days), not NaN", () => {
    expect(avgDailyOverActiveDays([])).toEqual({ activeDays: 0, avg: 0 });
  });
});

describe("utilizationPct", () => {
  it("computes the plain ratio inside the honest range", () => {
    expect(utilizationPct(5, 10)).toBe(50);
  });

  it("clamps at 100 when the activity window outruns the denominator", () => {
    // The shipped defect's shape: a 28h UTC-day window over 10 elapsed ET
    // hours must not publish 280%.
    expect(utilizationPct(28, 10)).toBe(100);
  });

  it("guards the zero denominator", () => {
    expect(utilizationPct(0, 0)).toBe(0);
  });
});
