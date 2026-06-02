import { describe, it, expect } from "vitest";

import {
  computeTrends,
  buildSeries,
  type MetricSeries,
  type MetricPoint,
} from "@/lib/brain/analyzers/trends";

const NOW = new Date(2026, 1, 1); // fixed — no Date.now()

/** Deterministic date n days after a fixed epoch (no Date.now). */
function day(offset: number): Date {
  return new Date(2026, 0, 1 + offset);
}

/** One metric series from a list of daily values (index = day offset). */
function series(
  name: string,
  values: (number | null)[],
  extra: Partial<MetricSeries> = {},
): MetricSeries {
  const points: MetricPoint[] = [];
  values.forEach((v, i) => {
    if (v != null) points.push({ date: day(i), value: v });
  });
  return {
    name,
    unit: extra.unit ?? "/10",
    // preserve an explicitly-passed null (?? would collapse it to true)
    higherIsBetter: "higherIsBetter" in extra ? (extra.higherIsBetter ?? null) : true,
    points,
  };
}

describe("computeTrends", () => {
  it("detects a rising metric (direction + positive per-month change)", () => {
    // mood climbs 4 -> 9 over 10 logged days
    const s = series(
      "mood",
      Array.from({ length: 10 }, (_, i) => Math.min(9, 4 + i * 0.6)),
    );
    const r = computeTrends([s], NOW);
    const mood = r.metrics.find((m) => m.name === "mood");
    expect(mood?.insufficient).toBe(false);
    expect(mood?.direction).toBe("rising");
    expect(mood?.perMonthChange ?? 0).toBeGreaterThan(0.5);
    // it should be the top mover
    expect(r.topMovers[0]?.name).toBe("mood");
    expect(r.topMovers[0]?.direction).toBe("rising");
  });

  it("detects a falling metric", () => {
    // energy drops 9 -> 3 over 10 days
    const s = series(
      "energy",
      Array.from({ length: 10 }, (_, i) => Math.max(3, 9 - i * 0.7)),
    );
    const r = computeTrends([s], NOW);
    const energy = r.metrics.find((m) => m.name === "energy");
    expect(energy?.direction).toBe("falling");
    expect(energy?.perMonthChange ?? 0).toBeLessThan(-0.5);
  });

  it("flags a recent-vs-prior change-point when the second half shifts", () => {
    // weight flat ~180 for 5 days, then jumps to ~190 for 5 days
    const vals = [180, 180, 181, 180, 179, 190, 191, 190, 192, 191];
    const s = series("weight", vals, { unit: "lb", higherIsBetter: null });
    const r = computeTrends([s], NOW);
    const w = r.metrics.find((m) => m.name === "weight");
    expect(w?.changePoint).not.toBeNull();
    expect(w?.changePoint?.shifted).toBe(true);
    expect(w?.changePoint?.delta ?? 0).toBeGreaterThan(5);
    // a flagged shift should surface in guidance
    expect(r.guidance.join(" ")).toMatch(/recent shift/i);
  });

  it("does NOT flag a change-point when the window is steady", () => {
    const s = series("mood", Array.from({ length: 10 }, () => 7));
    const r = computeTrends([s], NOW);
    const mood = r.metrics.find((m) => m.name === "mood");
    expect(mood?.direction).toBe("flat");
    expect(mood?.changePoint?.shifted).toBe(false);
  });

  it("surfaces a strong correlation between two co-moving metrics", () => {
    // sleep and mood rise together on the same days → strong positive r
    const sleep = series(
      "sleepHours",
      Array.from({ length: 10 }, (_, i) => 5 + i * 0.4),
      { unit: "h" },
    );
    const mood = series(
      "mood",
      Array.from({ length: 10 }, (_, i) => 3 + i * 0.6),
    );
    const r = computeTrends([sleep, mood], NOW);
    expect(r.correlations.length).toBeGreaterThan(0);
    const c = r.correlations[0];
    expect([c.a, c.b].sort()).toEqual(["mood", "sleepHours"]);
    expect(c.r).toBeGreaterThan(0.5);
    expect(c.strength).toBe("strong");
    expect(c.pairs).toBe(10);
  });

  it("reports a metric with <5 points as insufficient, not a trend", () => {
    const s = series("dailyScore", [70, 80, 75], { unit: "" });
    const r = computeTrends([s], NOW);
    const ds = r.metrics.find((m) => m.name === "dailyScore");
    expect(ds?.insufficient).toBe(true);
    expect(ds?.perMonthChange).toBeNull();
    expect(ds?.direction).toBe("flat");
    // not enough trended metrics → honest, no fabricated trend
    expect(r.dataCompleteness.sufficient).toBe(false);
    expect(r.guidance.join(" ")).toMatch(/not enough logged data/i);
  });

  it("returns an honest gap for empty input", () => {
    const r = computeTrends([], NOW);
    expect(r.dataCompleteness.metricsTracked).toBe(0);
    expect(r.dataCompleteness.totalPoints).toBe(0);
    expect(r.dataCompleteness.sufficient).toBe(false);
    expect(r.metrics).toEqual([]);
    expect(r.topMovers).toEqual([]);
    expect(r.correlations).toEqual([]);
    expect(r.dataCompleteness.note).toMatch(/no tracked metrics/i);
  });

  it("carries higherIsBetter through without moralizing weight direction", () => {
    // weight rising should report direction 'rising' with higherIsBetter=null
    const s = series(
      "weight",
      Array.from({ length: 8 }, (_, i) => 180 + i),
      { unit: "lb", higherIsBetter: null },
    );
    const r = computeTrends([s], NOW);
    const w = r.metrics.find((m) => m.name === "weight");
    expect(w?.higherIsBetter).toBeNull();
    expect(w?.direction).toBe("rising");
    // guidance describes the move but never labels it good/bad
    expect(r.guidance.join(" ")).not.toMatch(/bad|worse|unhealthy|too heavy/i);
  });
});

describe("buildSeries", () => {
  it("maps daily + body rows into named series, skipping nulls", () => {
    const daily = [
      {
        logDate: day(0),
        moodScore: 7,
        energyScore: null,
        sleepHours: 7.5,
        dailyScore: 80,
        driftIncidents: 2,
        deepWorkBlocks: 3,
        workoutCompleted: true,
      },
      {
        logDate: day(1),
        moodScore: 6,
        energyScore: 5,
        sleepHours: null,
        dailyScore: null,
        driftIncidents: 0,
        deepWorkBlocks: 1,
        workoutCompleted: false,
      },
    ];
    const body = [
      {
        date: "2026-01-01",
        weight: 180,
        bodyFatPct: null,
        waistInches: 34,
        sleepHours: 7,
        energy: 6,
        stress: 4,
        workoutDone: true,
      },
    ];
    const out = buildSeries(daily, body);
    const mood = out.find((s) => s.name === "mood");
    const energy = out.find((s) => s.name === "energy");
    const workout = out.find((s) => s.name === "workout");
    const weight = out.find((s) => s.name === "weight");
    expect(mood?.points.length).toBe(2);
    expect(energy?.points.length).toBe(1); // null energy on day 0 skipped
    expect(workout?.points.map((p) => p.value)).toEqual([1, 0]); // bool -> 1/0
    expect(weight?.points[0].value).toBe(180);
    // the two energy sources stay distinct
    expect(out.some((s) => s.name === "energy(body)")).toBe(true);
  });
});
