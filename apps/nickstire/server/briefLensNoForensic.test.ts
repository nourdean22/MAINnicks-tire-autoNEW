/**
 * The AI brief path never returns the forensic evidence lens (2026-10-12).
 *
 * forensic_evidence_scan is retired from brief generation. The MotionLens type
 * keeps the member so jobs already queued with it still parse, but nothing new
 * may draw it. Two paths choose a motionLens for a generated brief: the model's
 * JSON (coerced in reelBriefGen) and the pack-derived rotation (lensPoolFor in
 * approvedReelPackRotation). Both are asserted here.
 */
import { describe, expect, it } from "vitest";
import { coerceBriefMotionLens } from "./services/reelBriefGen";
import { lensPoolFor } from "./services/approvedReelPackRotation";
import type { VisualDirectionId } from "../shared/contentExperiments";

const FORENSIC = "forensic_evidence_scan";

describe("the AI brief path never returns the forensic evidence lens", () => {
  it("model output naming the forensic lens, by key or label, coerces to another lens", () => {
    for (const raw of [FORENSIC, "Forensic Evidence Scan", "FORENSIC_EVIDENCE_SCAN"]) {
      expect(coerceBriefMotionLens(raw), `raw "${raw}"`).not.toBe(FORENSIC);
    }
    // CONTROL: a live lens still comes back as itself, so the fallback is not swallowing everything.
    expect(coerceBriefMotionLens("neon_retro_futurist")).toBe("neon_retro_futurist");
  });

  it("pack rotation draws from a pool with no forensic lens, for the default and both visual_direction arms", () => {
    const directions: (VisualDirectionId | undefined)[] = [undefined, "documentary", "cinematic"];
    for (const direction of directions) {
      const pool = lensPoolFor(direction);
      expect(pool, `direction ${direction ?? "none"}`).not.toContain(FORENSIC);
      expect(pool.length).toBeGreaterThan(0);
    }
  });
});
