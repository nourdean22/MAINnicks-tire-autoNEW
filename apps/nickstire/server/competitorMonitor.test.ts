/**
 * competitorMonitor — threshold-detection + alert-key pins (2026-08-11).
 *
 * detectChanges is PURE as of the threshold-alerts wave: it must never
 * send anything. The Telegram side lives in fireThresholdAlerts (flag-
 * gated, cron_alerts_fired dedup) and is exercised via the pure pieces
 * pinned here — the DB claim itself follows the vapiLatencySync pattern.
 */
import { describe, expect, it } from "vitest";
import { buildAlertKey, detectChanges } from "./services/competitorMonitor";

function row(over: Partial<{ name: string; placeId: string; rating: number; reviewCount: number; fetchedAt: Date }>) {
  return {
    name: "Moe's Tire Center",
    placeId: "place-moes",
    rating: 4.3,
    reviewCount: 639,
    fetchedAt: new Date("2026-08-11T12:00:00Z"),
    ...over,
  };
}

describe("detectChanges thresholds", () => {
  it("flags a >=10 review gain with metric 'reviews'", () => {
    const changes = detectChanges([row({})], [row({ reviewCount: 650 })]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ placeId: "place-moes", metric: "reviews", severity: "warning" });
  });

  it("stays silent under the review threshold (+9)", () => {
    expect(detectChanges([row({})], [row({ reviewCount: 648 })])).toEqual([]);
  });

  it("flags a rating move of >=0.2 in either direction with metric 'rating'", () => {
    const up = detectChanges([row({})], [row({ rating: 4.5 })]);
    const down = detectChanges([row({})], [row({ rating: 4.1 })]);
    expect(up[0]).toMatchObject({ metric: "rating", severity: "info" });
    expect(down[0]).toMatchObject({ metric: "rating", severity: "warning" });
  });

  it("produces no changes without a baseline (first-ever run)", () => {
    expect(detectChanges([], [row({ reviewCount: 700 })])).toEqual([]);
  });

  it("reports both metrics for the same competitor as separate changes", () => {
    const changes = detectChanges([row({})], [row({ reviewCount: 660, rating: 4.6 })]);
    expect(changes.map((c) => c.metric).sort()).toEqual(["rating", "reviews"]);
  });
});

describe("buildAlertKey", () => {
  it("is stable per competitor x metric and fits VARCHAR(100)", () => {
    const key = buildAlertKey({ placeId: "ChIJabcdefghijklmnopqrstuv", metric: "reviews" });
    expect(key).toBe("cmp:ChIJabcdefghijklmnopqrstuv:reviews");
    expect(key.length).toBeLessThanOrEqual(100);
  });

  it("differs between metrics so one breach never masks the other", () => {
    expect(buildAlertKey({ placeId: "p1", metric: "reviews" })).not.toBe(
      buildAlertKey({ placeId: "p1", metric: "rating" }),
    );
  });
});
