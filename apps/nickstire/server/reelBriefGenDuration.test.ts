/**
 * duration_v1 wiring: the assigned lane sets the brief's target length.
 *
 * Two halves. The store resolves the lane for an episode from the RUNNING
 * length_band experiment exactly the way the hook arm is resolved (same
 * query, same deterministic assignment, same "a failed read is control").
 * The generator clamps the lane to REEL_OUTPUT_RULES and writes the prompt
 * block — pure, so the 45-60 s lane's cap is asserted rather than hoped for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let experimentRows: unknown[] | Error = [];

vi.mock("../drizzle/schema", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, contentExperiments: { status: "status", primaryVariable: "primaryVariable", startedAt: "startedAt" } };
});

function thenable(value: unknown[] | Error) {
  const p = value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  p.catch(() => {});
  return Object.assign(p, { orderBy: () => Object.assign(Promise.resolve(value), { limit: () => p }) });
}

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => thenable(experimentRows) }) }),
  }),
}));

import { durationLaneForEpisode, hookArmForEpisode } from "./services/contentExperimentStore";
import { buildDurationLaneFragment, clampDurationLane } from "./services/reelBriefGen";
import { REEL_OUTPUT_RULES } from "../client/src/lib/facelessReelStudio";
import { buildExperimentPreset } from "../shared/contentExperiments";

const runningDuration = () => {
  const def = buildExperimentPreset("duration_v1", "2026-10-01T00:00:00.000Z");
  return [{ experimentId: def.experimentId, primaryVariable: def.primaryVariable, objective: def.objective, primaryMetric: def.primaryMetric, armsJson: def.arms, startedAt: new Date(def.startedAt) }];
};

describe("durationLaneForEpisode", () => {
  beforeEach(() => { experimentRows = []; });

  it("is undefined when no length_band experiment is running — the default, prompt untouched", async () => {
    await expect(durationLaneForEpisode("autopost-2026-10-01")).resolves.toBeUndefined();
  });

  it("returns a declared lane, deterministically, when duration_v1 is running", async () => {
    experimentRows = runningDuration();
    const first = await durationLaneForEpisode("autopost-2026-10-01");
    const again = await durationLaneForEpisode("autopost-2026-10-01");
    expect(first).toBeDefined();
    expect(["18-24s", "30-40s", "45-60s"]).toContain(first);
    expect(again).toBe(first);
    // Different episodes spread across the three lanes.
    const lanes = new Set(await Promise.all(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((k) => durationLaneForEpisode(k))));
    expect(lanes.size).toBeGreaterThan(1);
  });

  it("an arm naming an undeclared lane is control, not a guess", async () => {
    experimentRows = [{ experimentId: "x", primaryVariable: "length_band", objective: "discovery", primaryMetric: "shares", armsJson: [
      { armId: "a", variantValue: "20s", lengthBand: "20s" }, { armId: "b", variantValue: "90s", lengthBand: "90s" },
    ], startedAt: new Date() }];
    await expect(durationLaneForEpisode("k")).resolves.toBeUndefined();
  });

  it("a failed read is control (undefined), never a thrown generation", async () => {
    experimentRows = new Error("connection refused");
    await expect(durationLaneForEpisode("k")).resolves.toBeUndefined();
    // The hook reader shares the same path and keeps its contract.
    await expect(hookArmForEpisode("k")).resolves.toBeUndefined();
  });
});

describe("clampDurationLane", () => {
  it("18-24 s and 30-40 s fit inside the storyboard contract; 30-40 is capped at the 35 s ceiling", () => {
    expect(clampDurationLane("18-24s")).toMatchObject({ minSeconds: 18, maxSeconds: 24, capped: false });
    expect(clampDurationLane("30-40s")).toMatchObject({ minSeconds: 30, maxSeconds: REEL_OUTPUT_RULES.maxSeconds, capped: true });
  });

  it("45-60 s lies entirely above the ceiling: targets the top of what is accepted and is marked capped", () => {
    const t = clampDurationLane("45-60s");
    expect(t.capped).toBe(true);
    expect(t.maxSeconds).toBe(REEL_OUTPUT_RULES.maxSeconds);
    expect(t.minSeconds).toBeLessThanOrEqual(t.maxSeconds);
    expect(t.minSeconds).toBeGreaterThanOrEqual(REEL_OUTPUT_RULES.minSeconds);
  });

  it("names the render cap the assembly actually enforces (maxBeats x maxClipSeconds)", () => {
    expect(clampDurationLane("18-24s").renderCapSeconds).toBe(REEL_OUTPUT_RULES.maxBeats * REEL_OUTPUT_RULES.maxClipSeconds);
  });
});

describe("buildDurationLaneFragment", () => {
  it("states the lane and the end-second bounds the storyboard must land in", () => {
    const f = buildDurationLaneFragment(clampDurationLane("18-24s"));
    expect(f).toContain('EXPERIMENT ARM "18-24s"');
    expect(f).toContain("end between 18s and 24s");
    expect(f).not.toContain("capped");
  });

  it("says so when the lane was capped, so the model does not reach for 60 s", () => {
    const f = buildDurationLaneFragment(clampDurationLane("45-60s"));
    expect(f).toContain(`capped to the ${REEL_OUTPUT_RULES.maxSeconds}s storyboard ceiling`);
  });
});
