/**
 * Experiment arm key agreement (found 2026-10-01 by the Wave B agent, fixed here).
 *
 * POSITIVE CONTROL: before this change `assignEpisodeToActiveExperiment`
 * derived the recorded arm from `reel_job_<id>` while generation derived the
 * generated arm from the brief id. `assignArm` hashes its key, so for the two
 * keys below the arms DIFFER — the "recorded ≠ generated" shape the fix removes.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assignArm, type ExperimentDefinition } from "../shared/contentExperiments";
import { experimentEpisodeKey } from "./services/contentExperimentStore";
import { sliceBlock } from "./testUtils/sourceBlock";

const def: ExperimentDefinition = {
  experimentId: "hook-style-direct-v1",
  primaryVariable: "hook_style",
  objective: "discovery",
  primaryMetric: "shares_per_reach",
  arms: [
    { armId: "hook-control", variantValue: "baseline", hookStyle: "baseline" },
    { armId: "hook-direct", variantValue: "direct", hookStyle: "direct" },
  ],
  startedAt: "2026-10-01T00:00:00.000Z",
};

describe("experimentEpisodeKey", () => {
  it("records under the brief id when the caller has one, so recorded == generated", () => {
    const briefId = "autopost-2026-10-01";
    expect(experimentEpisodeKey(1920018, briefId)).toBe(briefId);
    expect(assignArm(def, experimentEpisodeKey(1920018, briefId)).armId).toBe(assignArm(def, briefId).armId);
  });
  it("falls back to the job key only when no brief id exists", () => {
    expect(experimentEpisodeKey(42)).toBe("reel_job_42");
    expect(experimentEpisodeKey(42, "   ")).toBe("reel_job_42");
  });
  it("control: the old job-key derivation disagrees with the brief-key derivation for a real pair", () => {
    // Search a small space for a (jobId, briefId) pair the two keys split on —
    // the defect only needs one to exist, and ~half of all pairs do.
    let split = false;
    for (let job = 1; job < 64 && !split; job++) {
      const a = assignArm(def, `reel_job_${job}`).armId;
      const b = assignArm(def, `autopost-2026-10-${String((job % 28) + 1).padStart(2, "0")}`).armId;
      if (a !== b) split = true;
    }
    expect(split).toBe(true);
  });
  it("wiring: the enqueue site passes the brief id", () => {
    const src = fs.readFileSync(path.join(__dirname, "services/reelPipeline.ts"), "utf8");
    const call = sliceBlock(src, "await assignEpisodeToActiveExperiment(jobId, {", "});", { label: "reelPipeline.ts" });
    expect(call).toContain("briefId: brief.id,");
    // A pack-built brief is recorded as the pack, never as AI-written (2026-10-08).
    expect(call).toContain('contentOrigin: approvedPackSlug ? "approved_pack" : "ai_generated",');
  });
});
