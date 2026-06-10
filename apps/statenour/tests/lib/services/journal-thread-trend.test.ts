import { describe, it, expect } from "vitest";
import { computeThreadTrend } from "@/lib/services/journal-thread-trend";

describe("computeThreadTrend", () => {
  it("dormant threads are stale regardless of joins", () => {
    expect(
      computeThreadTrend({ status: "dormant", daysSinceJoin: 2, joins7d: 5, joinsPrior7d: 0 }),
    ).toBe("stale");
  });

  it("active thread quiet 14+ days is fading", () => {
    expect(
      computeThreadTrend({ status: "active", daysSinceJoin: 14, joins7d: 0, joinsPrior7d: 3 }),
    ).toBe("fading");
  });

  it("2+ joins this week AND accelerating is strengthening", () => {
    expect(
      computeThreadTrend({ status: "active", daysSinceJoin: 1, joins7d: 3, joinsPrior7d: 1 }),
    ).toBe("strengthening");
  });

  it("a single join never counts as strengthening (no overclaiming)", () => {
    expect(
      computeThreadTrend({ status: "active", daysSinceJoin: 1, joins7d: 1, joinsPrior7d: 0 }),
    ).toBe("steady");
  });

  it("busy but NOT accelerating is steady, not strengthening", () => {
    expect(
      computeThreadTrend({ status: "active", daysSinceJoin: 1, joins7d: 3, joinsPrior7d: 3 }),
    ).toBe("steady");
  });

  it("alive with no recent joins is steady", () => {
    expect(
      computeThreadTrend({ status: "active", daysSinceJoin: 5, joins7d: 0, joinsPrior7d: 0 }),
    ).toBe("steady");
  });
});
