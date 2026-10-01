/**
 * §R presets: every one must be a design the evaluator can actually decide —
 * two or more arms, no confounds, a metric with a declared aggregation — and
 * hook_style_v1 must keep its original id and arms so re-starting it is the
 * idempotent re-assert it has always been, not a second experiment.
 */
import { describe, it, expect } from "vitest";
import {
  DURATION_LANES,
  EXPERIMENT_PRESET_IDS,
  buildExperimentPreset,
  findConfounds,
  isDurationLaneId,
  metricSpec,
  assignArm,
} from "./contentExperiments";

describe("buildExperimentPreset", () => {
  it("covers all six §R presets and each is decidable", () => {
    expect([...EXPERIMENT_PRESET_IDS]).toEqual([
      "hook_style_v1", "duration_v1", "opening_asset_v1", "carousel_cover_v1", "audio_v1", "fb_format_v1",
    ]);
    for (const id of EXPERIMENT_PRESET_IDS) {
      const def = buildExperimentPreset(id, "2026-10-01T00:00:00.000Z");
      expect(def.preset).toBe(id);
      expect(def.arms.length).toBeGreaterThanOrEqual(2);
      expect(findConfounds(def)).toEqual([]);
      expect(metricSpec(def.primaryMetric)).not.toBeNull();
      expect(new Set(def.arms.map((a) => a.armId)).size).toBe(def.arms.length);
      expect(def.metricNote.length).toBeGreaterThan(10);
    }
  });

  it("hook_style_v1 is byte-identical to the experiment that has been live since 0108", () => {
    const def = buildExperimentPreset("hook_style_v1", "x");
    expect(def.experimentId).toBe("hook-style-direct-v1");
    expect(def.arms).toEqual([
      { armId: "hook-control", variantValue: "baseline", hookStyle: "baseline" },
      { armId: "hook-direct", variantValue: "direct", hookStyle: "direct" },
    ]);
    expect(def.primaryMetric).toBe("shares_per_reach");
    expect(def.wiring).toBe("wired");
  });

  it("duration_v1 arms are exactly the declared lanes, on length_band, and the variant IS the lane id", () => {
    const def = buildExperimentPreset("duration_v1", "x");
    expect(def.primaryVariable).toBe("length_band");
    expect(def.wiring).toBe("wired");
    expect(def.arms.map((a) => a.variantValue)).toEqual(["18-24s", "30-40s", "45-60s"]);
    for (const arm of def.arms) {
      expect(isDurationLaneId(arm.lengthBand)).toBe(true);
      expect(DURATION_LANES[arm.variantValue as keyof typeof DURATION_LANES].minSeconds).toBeLessThan(
        DURATION_LANES[arm.variantValue as keyof typeof DURATION_LANES].maxSeconds,
      );
    }
    // Same episode key, same lane, every time — a retry cannot re-roll.
    expect(assignArm(def, "autopost-2026-10-01")).toEqual(assignArm(def, "autopost-2026-10-01"));
  });

  it("only hook_style_v1 and duration_v1 claim to be wired; the rest say exposed", () => {
    const wiring = Object.fromEntries(EXPERIMENT_PRESET_IDS.map((id) => [id, buildExperimentPreset(id, "x").wiring]));
    expect(wiring).toEqual({
      hook_style_v1: "wired", duration_v1: "wired",
      opening_asset_v1: "exposed", carousel_cover_v1: "exposed", audio_v1: "exposed", fb_format_v1: "exposed",
    });
  });

  it("the new primary variables are confound-checked, not exempt by omission", () => {
    const def = buildExperimentPreset("audio_v1", "x");
    const confounded = { ...def, arms: [def.arms[0], { ...def.arms[1], fbFormat: "album" }] };
    expect(findConfounds(confounded)).toEqual(["fbFormat"]);
    const cover = buildExperimentPreset("carousel_cover_v1", "x");
    expect(findConfounds({ ...cover, arms: [cover.arms[0], { ...cover.arms[1], audioStyle: "vo_foley" }] })).toEqual(["audioStyle"]);
  });

  it("isDurationLaneId rejects anything DURATION_LANES does not declare", () => {
    expect(isDurationLaneId("30-40s")).toBe(true);
    expect(isDurationLaneId("20s")).toBe(false);
    expect(isDurationLaneId(undefined)).toBe(false);
    expect(isDurationLaneId("toString")).toBe(false);
  });
});
