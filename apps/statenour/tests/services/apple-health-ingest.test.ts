import { describe, it, expect } from "vitest";
import {
  transformHaePayload,
  deriveSampleId,
  datesTouchedEt,
  type CanonicalSample,
} from "@/lib/services/apple-health-ingest";
import { buildBodyPatch } from "@/lib/services/health-summary";

describe("HAE payload transform (pure)", () => {
  const hae = {
    data: {
      metrics: [
        {
          name: "step_count",
          units: "count",
          data: [{ date: "2026-07-28 08:41:00 -0400", qty: 3142, source: "iPhone" }],
        },
        {
          name: "sleep_analysis",
          units: "hr",
          data: [{ date: "2026-07-28 07:02:00 -0400", asleep: 6.2, inBed: 6.9, source: "Apple Watch" }],
        },
        { name: "empty_metric", units: "count", data: [] },
      ],
      workouts: [
        { name: "Running", start: "2026-07-27 18:00:00 -0400", end: "2026-07-27 18:31:00 -0400", duration: 1860 },
      ],
    },
  };

  it("maps scalars, splits sleep into asleep/inBed metrics, maps workouts", () => {
    const samples = transformHaePayload(hae);
    const types = samples.map((s) => s.type).sort();
    expect(types).toEqual(["sleep_asleep_hours", "sleep_in_bed_hours", "step_count", "workout"]);
    const steps = samples.find((s) => s.type === "step_count")!;
    expect(steps.value).toBe(3142);
    expect(steps.startAt.endsWith("Z")).toBe(true); // normalized to ISO UTC
  });

  // 2026-10-29 · prod held 75 of 93 sleep nights as 0 h: HAE's aggregated
  // sleep_analysis puts time asleep in `totalSleep` (and the stages), while
  // `asleep` is 0 on a staged Apple Watch night. Shapes below are from the
  // vendor's Health Metrics doc (help.healthyapps.dev, export-format).
  const sleepOnly = (point: Record<string, unknown>) =>
    transformHaePayload({
      data: { metrics: [{ name: "sleep_analysis", units: "hr", data: [{ date: "2026-08-02 00:00:00 -0400", ...point }] }] },
    });
  const hours = (samples: CanonicalSample[], type: string) =>
    samples.filter((s) => s.type === type).map((s) => s.value);

  it("prefers totalSleep over asleep (vendor's documented aggregated shape)", () => {
    const s = sleepOnly({ totalSleep: 7.5, asleep: 7.0, core: 3.5, deep: 1.5, rem: 2.0, inBed: 8.0 });
    expect(hours(s, "sleep_asleep_hours")).toEqual([7.5]);
    expect(hours(s, "sleep_in_bed_hours")).toEqual([8.0]);
  });

  it("a staged Apple Watch night (asleep 0) reads totalSleep, not 0 hours", () => {
    expect(hours(sleepOnly({ totalSleep: 6.4, asleep: 0, core: 3.9, deep: 0.9, rem: 1.6, inBed: 0 }), "sleep_asleep_hours")).toEqual([6.4]);
  });

  it("without totalSleep, sums core + deep + rem before trusting a 0 asleep", () => {
    const [v] = hours(sleepOnly({ asleep: 0, core: 3.5, deep: 1.0, rem: 1.5 }), "sleep_asleep_hours");
    expect(v).toBeCloseTo(6.0, 5);
  });

  it("a night with no sleep measured is UNKNOWN (no sample), never 0 hours", () => {
    expect(sleepOnly({ totalSleep: 0, asleep: 0, core: 0, deep: 0, rem: 0, inBed: 0 })).toEqual([]);
  });

  it("returns [] for unrecognizable payloads (loud 422 at the route)", () => {
    expect(transformHaePayload({ hello: "world" })).toEqual([]);
    expect(transformHaePayload(null)).toEqual([]);
  });

  it("deriveSampleId is deterministic — replayed exports dedupe at the constraint", () => {
    const s: CanonicalSample = { type: "step_count", startAt: "2026-07-28T12:41:00.000Z", value: 3142 };
    expect(deriveSampleId(s)).toBe(deriveSampleId({ ...s }));
    expect(deriveSampleId(s)).not.toBe(deriveSampleId({ ...s, value: 3143 }));
  });

  it("datesTouchedEt buckets UTC instants into ET calendar days", () => {
    // 03:30 UTC on the 29th = 11:30 PM ET on the 28th (EDT)
    const days = datesTouchedEt([
      { type: "x", startAt: "2026-07-29T03:30:00.000Z" },
      { type: "x", startAt: "2026-07-28T12:00:00.000Z" },
    ]);
    expect(days).toEqual(["2026-07-28"]);
  });
});

describe("buildBodyPatch (pure) — manual entries always win", () => {
  const agg = { sleepHours: 6.2, weightLb: 210.4, bodyFatPct: 24.1, workoutDone: true };

  it("fills every null field on an empty row", () => {
    expect(buildBodyPatch(null, agg)).toEqual({
      sleepHours: 6.2,
      weight: 210.4,
      bodyFatPct: 24.1,
      workoutDone: true,
    });
  });

  it("NEVER overwrites a non-null (manual) value", () => {
    const patch = buildBodyPatch(
      { sleepHours: 7.5, weight: null, bodyFatPct: 25.0, workoutDone: null },
      agg,
    );
    expect(patch).toEqual({ weight: 210.4, workoutDone: true });
  });

  it("empty aggregates produce an empty patch (day untouched)", () => {
    expect(
      buildBodyPatch(null, { sleepHours: null, weightLb: null, bodyFatPct: null, workoutDone: false }),
    ).toEqual({});
  });
});
