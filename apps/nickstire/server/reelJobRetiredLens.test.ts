/**
 * A reel job queued before the retired lens was purged may still carry it in
 * its payload. parseReelJobPayload is the one parse boundary, so it must hand
 * back the standard lens instead of a value no renderer knows.
 */
import { describe, expect, it } from "vitest";
import { parseReelJobPayload } from "../shared/reelJobPayload";
import { lensPoolFor } from "./services/approvedReelPackRotation";

describe("a stored job carrying the retired lens still parses", () => {
  it("falls back to the standard lens", () => {
    const view = parseReelJobPayload(JSON.stringify({ motionLens: "forensic_evidence_scan", topic: "x" }));
    expect(view.motionLens).toBe("hyperreal_cinematic");
    expect(view.topic).toBe("x");
  });

  it("CONTROL: a live lens passes through unchanged", () => {
    expect(parseReelJobPayload(JSON.stringify({ motionLens: "neon_retro_futurist" })).motionLens).toBe("neon_retro_futurist");
  });

  it("CONTROL: an unparsable payload still returns an empty view", () => {
    expect(parseReelJobPayload("{not json")).toEqual({});
  });

  it("the rotation pool for a new pack is non-empty for the default and both arms", () => {
    for (const direction of [undefined, "documentary", "cinematic"] as const) {
      expect(lensPoolFor(direction).length).toBeGreaterThan(0);
    }
  });
});
