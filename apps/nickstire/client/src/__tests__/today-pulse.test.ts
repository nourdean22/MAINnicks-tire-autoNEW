import { describe, it, expect } from "vitest";
import { mirrorLagDays, mirrorFreshness, abandonRate, MIRROR_STALE_WARN_DAYS } from "../pages/admin/today/todayPulse";

const NOW = new Date("2026-07-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("mirrorLagDays", () => {
  it("counts whole days behind", () => {
    expect(mirrorLagDays(daysAgo(3), NOW)).toBe(3);
  });

  // "never synced" and "synced today" are opposite conditions. Returning 0 for
  // the first would render the broken mirror as the healthy one.
  it("returns null — not 0 — when nothing has ever synced", () => {
    expect(mirrorLagDays(null, NOW)).toBeNull();
  });

  it("never reports a negative age when the clock is skewed", () => {
    expect(mirrorLagDays(new Date(NOW.getTime() + 60_000), NOW)).toBe(0);
  });
});

describe("mirrorFreshness", () => {
  it("stays QUIET at a one-day lag — that is normal here", () => {
    const f = mirrorFreshness(daysAgo(1), NOW);
    expect(f.stale).toBe(false);
    expect(f.label).toBe("through yesterday");
  });

  it("stays quiet at the threshold and goes loud past it", () => {
    expect(mirrorFreshness(daysAgo(MIRROR_STALE_WARN_DAYS), NOW).stale).toBe(false);
    expect(mirrorFreshness(daysAgo(MIRROR_STALE_WARN_DAYS + 1), NOW).stale).toBe(true);
  });

  it("treats a never-synced mirror as stale, not as current", () => {
    const f = mirrorFreshness(null, NOW);
    expect(f.stale).toBe(true);
    expect(f.label).toMatch(/no invoices/);
  });
});

describe("abandonRate", () => {
  it("computes the share that hung up early", () => {
    expect(abandonRate({ last24h: 31, abandoned24h: 5 })).toBe(16);
  });

  // A quiet overnight window is not a 0% abandon rate — that would be a
  // measurement invented out of an absence of calls.
  it("returns null when there were no calls to measure", () => {
    expect(abandonRate({ last24h: 0, abandoned24h: 0 })).toBeNull();
  });
});
