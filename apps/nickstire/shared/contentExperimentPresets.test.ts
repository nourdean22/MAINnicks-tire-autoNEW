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
  isUnwiredExperimentId,
  metricSpec,
  SNAPSHOT_COLUMN_FOR_METRIC,
  assignArm,
  MIXED_HASH_VARIABLES,
} from "./contentExperiments";

describe("buildExperimentPreset", () => {
  it("covers the six §R presets plus the two pack-build presets, and each is decidable", () => {
    expect([...EXPERIMENT_PRESET_IDS]).toEqual([
      "hook_style_v1", "duration_v1", "opening_asset_v1", "carousel_cover_v1", "audio_v1", "fb_format_v1",
      "visual_direction_v1", "opening_mechanism_v1",
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

  it("hook_style_v1, duration_v1, visual_direction_v1 and opening_mechanism_v1 are wired; the rest say exposed, and reach nothing", () => {
    const presets = EXPERIMENT_PRESET_IDS.map((id) => buildExperimentPreset(id, "x"));
    expect(Object.fromEntries(presets.map((d) => [d.preset, d.wiring]))).toEqual({
      hook_style_v1: "wired", duration_v1: "wired", visual_direction_v1: "wired", opening_mechanism_v1: "wired",
      opening_asset_v1: "exposed", carousel_cover_v1: "exposed", audio_v1: "exposed", fb_format_v1: "exposed",
    });
    expect(Object.fromEntries(presets.map((d) => [d.preset, d.reaches]))).toEqual({
      hook_style_v1: "ai_written_briefs", duration_v1: "ai_written_briefs", visual_direction_v1: "pack_reels", opening_mechanism_v1: "pack_reels",
      opening_asset_v1: "none", carousel_cover_v1: "none", audio_v1: "none", fb_format_v1: "none",
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

describe("wired vs exposed (2026-10-08)", () => {
  it("isUnwiredExperimentId names exactly the exposed presets' experiment ids", () => {
    const exposed = EXPERIMENT_PRESET_IDS.map((id) => buildExperimentPreset(id, "x")).filter((d) => d.wiring === "exposed");
    expect(exposed.map((d) => isUnwiredExperimentId(d.experimentId))).toEqual(exposed.map(() => true));
    expect(isUnwiredExperimentId("hook-style-direct-v1")).toBe(false);
    expect(isUnwiredExperimentId("duration-lane-v1")).toBe(false);
    expect(isUnwiredExperimentId("some-other-experiment")).toBe(false);
  });

  it("wired presets that reach the SAME Reels have pairwise coprime arm counts, so concurrent ones are not confounded", () => {
    // assignArm hashes every experiment's episode key the same way, so two
    // running experiments with 2 arms each would put arm 0 with arm 0 on EVERY
    // episode they share: each would measure the other. Coprime counts make the
    // joint assignment uniform. Presets that reach disjoint Reels (a pack-build
    // arm and a brief-writing arm) share no episode, so their counts are free;
    // contentExperimentWiringGate.test.ts proves enqueue keeps them disjoint.
    // Wiring a preset that breaks this within one population needs a salted hash.
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    type P = ReturnType<typeof buildExperimentPreset>;
    const violations = (presets: P[]) => {
      const out: string[] = [];
      let shared = 0;
      for (let i = 0; i < presets.length; i++) for (let j = i + 1; j < presets.length; j++) {
        if (presets[i].reaches !== presets[j].reaches) continue;
        // A bit-mixed draw is independent of the parity arm whatever the counts
        // (packVariantExperiment.test.ts measures it over 120 daily keys).
        if (MIXED_HASH_VARIABLES.has(presets[i].primaryVariable) !== MIXED_HASH_VARIABLES.has(presets[j].primaryVariable)) continue;
        shared++;
        if (gcd(presets[i].arms.length, presets[j].arms.length) !== 1) out.push(`${presets[i].preset} vs ${presets[j].preset}`);
      }
      return { out, shared };
    };
    const wired = EXPERIMENT_PRESET_IDS.map((id) => buildExperimentPreset(id, "x")).filter((d) => d.wiring === "wired");
    const live = violations(wired);
    expect(live.shared).toBeGreaterThan(0); // the check ran on at least one shared population
    expect(live.out).toEqual([]);
    // CONTROL: a second 2-arm pack-build preset beside visual_direction_v1 is caught.
    const direction = buildExperimentPreset("visual_direction_v1", "x");
    expect(violations([...wired, { ...direction, preset: "hook_style_v1" as P["preset"] }]).out).toEqual(["visual_direction_v1 vs hook_style_v1"]);
  });

  it("opening_asset_v1 decides on its own hypothesis, 3-s survival, where lower skip wins", () => {
    const def = buildExperimentPreset("opening_asset_v1", "x");
    expect(def.primaryMetric).toBe("skip_rate");
    expect(metricSpec(def.primaryMetric)?.direction).toBe("LOWER_IS_BETTER");
  });
});

describe("gatherable metrics and METRIC_SPECS agree (2026-10-08)", () => {
  it("every metric name the resolver can gather has a registered aggregation and direction", () => {
    // Without this, a metric could be gathered and then refused `invalid_design`
    // on every run — the exact shape `skipRate` had before this test existed.
    for (const name of Object.keys(SNAPSHOT_COLUMN_FOR_METRIC)) expect(metricSpec(name), name).not.toBeNull();
  });
  it("every preset's primary metric is gatherable", () => {
    for (const id of EXPERIMENT_PRESET_IDS) {
      const def = buildExperimentPreset(id, "x");
      expect(SNAPSHOT_COLUMN_FOR_METRIC[def.primaryMetric], `${id}: ${def.primaryMetric}`).toBeTruthy();
    }
  });
});
