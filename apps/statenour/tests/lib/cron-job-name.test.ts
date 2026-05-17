/**
 * cronJobName() — ensures mega-fanout crons log with distinct jobNames
 * that match the CRONS manifest entries (mega-morning, mega-afternoon,
 * mega-evening, mega-late).
 *
 * Regression guard for the 2026-04-22 fix where every mega slot was
 * logging as jobName "mega" and /settings/crons showed all zeros for
 * every job because the lookup didn't match.
 */

import { describe, it, expect } from "vitest";
import { cronJobName } from "@/lib/utils/cron-job-name";

describe("cronJobName", () => {
  it("strips /api/cron/ prefix for simple crons", () => {
    const q = new URLSearchParams();
    expect(cronJobName("/api/cron/ingest-drive", q)).toBe("ingest-drive");
    expect(cronJobName("/api/cron/notification-sender", q)).toBe("notification-sender");
  });

  it("appends ?slot= query param for fanned-out crons", () => {
    const make = (slot: string) => new URLSearchParams({ slot });
    expect(cronJobName("/api/cron/mega", make("morning"))).toBe("mega-morning");
    expect(cronJobName("/api/cron/mega", make("afternoon"))).toBe("mega-afternoon");
    expect(cronJobName("/api/cron/mega", make("evening"))).toBe("mega-evening");
    expect(cronJobName("/api/cron/mega", make("late"))).toBe("mega-late");
  });

  it("falls back to ?task= when ?slot= is absent", () => {
    const q = new URLSearchParams({ task: "brain-cycle" });
    expect(cronJobName("/api/cron/mega", q)).toBe("mega-brain-cycle");
  });

  it("prefers ?slot= over ?task= when both are present", () => {
    const q = new URLSearchParams({ slot: "morning", task: "review" });
    expect(cronJobName("/api/cron/mega", q)).toBe("mega-morning");
  });

  it("ignores trailing path segments (e.g. nested cron routes)", () => {
    const q = new URLSearchParams();
    // If a cron lives at /api/cron/something/sub, only the first seg counts.
    expect(cronJobName("/api/cron/something/sub", q)).toBe("something");
  });

  it("handles empty query without appending a trailing dash", () => {
    const q = new URLSearchParams();
    expect(cronJobName("/api/cron/simple", q)).toBe("simple");
    expect(cronJobName("/api/cron/simple", q)).not.toContain("-");
  });
});
