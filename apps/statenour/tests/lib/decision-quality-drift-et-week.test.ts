/**
 * The weekly fan-out fires decision-quality-drift at Mon 03:00 UTC, which is
 * Sun 23:00 ET. Decision rows carry ET calendar dates (lib/utils/datetime.ts
 * today()). Bucketing "this week" from the UTC Monday just begun left the
 * recent bucket empty on every scheduled run, so the detector could never
 * alert. The week must be the ET week that is ending.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), create: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    masteryDecision: { findMany: (...a: unknown[]) => mocks.findMany(...a) },
    brainMemory: { create: (...a: unknown[]) => mocks.create(...a) },
  },
}));

import { runDecisionQualityDrift } from "@/lib/brain/decision-quality-drift";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: "x" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T03:00:00Z")); // Sun 2026-10-11 23:00 EDT
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runDecisionQualityDrift · scheduled at Sun 23:00 ET", () => {
  it("buckets the ET week that is ending (Mon 10-05..Sun 10-11) as recent", async () => {
    mocks.findMany.mockResolvedValue([
      // baseline: the 4 ET weeks before (09-07..10-04), high grades
      { grade: "A", date: "2026-09-08" },
      { grade: "A", date: "2026-09-15" },
      { grade: "B", date: "2026-09-22" },
      { grade: "A", date: "2026-09-29" },
      { grade: "A", date: "2026-10-04" },
      // recent: the ET week ending tonight, low grades
      { grade: "C", date: "2026-10-05" },
      { grade: "C", date: "2026-10-08" },
      { grade: "C", date: "2026-10-11" },
    ]);

    const r = await runDecisionQualityDrift();

    expect(r.recentSampleSize).toBe(3);
    expect(r.baselineSampleSize).toBe(5);
    expect(r.trend).toBe("down");
    expect(r.drift).toBe(true);
    expect(r.alertWritten).toBe(true);
    // the dedup key names the ET week that ended, not the UTC Monday
    expect(r.weekEndingDate).toBe("2026-10-11");
  });
});
