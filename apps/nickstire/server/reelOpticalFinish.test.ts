/**
 * A GENERATED CLIP IS PERFECTLY SMOOTH. REAL FOOTAGE NEVER IS.
 *
 * A sensor adds grain that MOVES between frames and a lens darkens toward the
 * corners. Their absence is a large part of what "looks AI-generated" means, and
 * no prompt fixes it - they are properties of the camera, not the scene.
 *
 * Every value here was measured on a 1080x1920 source with a flat brand-gold
 * subject (source YAVG 147.05, SATAVG 44.0), not chosen by taste:
 *
 *   luma-only grain      YAVG 146.5  SATAVG 44.0   (zero saturation cost)
 *   vignette PI/12       YAVG 146.2  SATAVG 43.8
 *   both together        YAVG 145.6  SATAVG 43.8
 *
 * And three candidates were REJECTED on measurement, which is what these pins
 * mostly exist to defend:
 *
 *   highlight bloom      costs ~10% saturation, delivers +0.2 luma
 *   chromatic aberration SATAVG 44.0 -> 39.8, a 9.5% desaturation of the hero
 *   colour grade         imposes one look over fourteen lens worlds
 *
 * Nick yellow is the one colour that must survive the pipeline. Two of those
 * three quietly wash it out, and both look like free realism until measured.
 */
import { describe, it, expect, afterEach } from "vitest";
import { opticalFinishFilter, FILM_GRAIN_STRENGTH } from "./services/reelAssembly";

const ORIGINAL = process.env.REEL_FILM_GRAIN;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.REEL_FILM_GRAIN;
  else process.env.REEL_FILM_GRAIN = ORIGINAL;
});

describe("the optical finish is OFF unless explicitly armed", () => {
  it("returns a no-op filter when the flag is unset", () => {
    delete process.env.REEL_FILM_GRAIN;
    expect(opticalFinishFilter()).toBe("null");
  });

  it("stays off for every truthy-looking value that is not exactly true", () => {
    // Grain is a bitrate multiplier on every published asset. An env var that
    // arms it on "1" or "yes" is an env var that arms it by accident.
    for (const v of ["1", "yes", "TRUE", "on", "", "false"]) {
      process.env.REEL_FILM_GRAIN = v;
      expect(opticalFinishFilter(), `armed on ${JSON.stringify(v)}`).toBe("null");
    }
  });

  it("returns a REAL filter, never an empty string, when off", () => {
    // The chain is [vpad]<filter>[vmaster]. An empty string there is not a
    // no-op, it is a malformed filtergraph and ffmpeg refuses the whole render.
    delete process.env.REEL_FILM_GRAIN;
    expect(opticalFinishFilter().length).toBeGreaterThan(0);
  });
});

describe("and when armed, it is the finish that was measured", () => {
  it("grain runs on the LUMA plane only", () => {
    // c0s targets plane 0. `alls` would apply it to chroma too, which measured
    // a ~12% saturation loss - chroma noise steals bitrate from chroma at a
    // fixed CRF, and the brand accent is what pays.
    process.env.REEL_FILM_GRAIN = "true";
    const f = opticalFinishFilter();
    expect(f).toContain(`noise=c0s=${FILM_GRAIN_STRENGTH}`);
    expect(f, "grain leaked onto the chroma planes").not.toContain("alls=");
  });

  it("the grain MOVES between frames", () => {
    // Static grain reads as dirt on the lens. `t` is the temporal flag.
    process.env.REEL_FILM_GRAIN = "true";
    expect(opticalFinishFilter()).toContain("allf=t+u");
  });

  it("carries the subtle vignette, not the heavy one", () => {
    process.env.REEL_FILM_GRAIN = "true";
    expect(opticalFinishFilter()).toContain("vignette=PI/12");
  });

  it("carries NONE of the three measured desaturators", () => {
    // This is the load-bearing assertion. Each of these looks like free lens
    // realism and each was measured washing the hero colour out.
    process.env.REEL_FILM_GRAIN = "true";
    const f = opticalFinishFilter();
    expect(f, "chromatic aberration is back - it cost 9.5% saturation").not.toContain("rgbashift");
    expect(f, "chroma shift is back").not.toContain("chromashift");
    expect(f, "highlight bloom is back - it cost ~10% saturation").not.toContain("blend=all_mode=screen");
    expect(f, "a global colour grade is back - the grade belongs to the lens").not.toContain("colortemperature");
    expect(f, "a global curve is back").not.toContain("curves=");
  });

  it("keeps the grain in a range that reads as texture, not as a broken encode", () => {
    expect(FILM_GRAIN_STRENGTH).toBeGreaterThan(0);
    expect(FILM_GRAIN_STRENGTH).toBeLessThanOrEqual(10);
  });
});
