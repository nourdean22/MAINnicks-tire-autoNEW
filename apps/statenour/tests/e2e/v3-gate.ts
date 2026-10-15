/**
 * v3-gate · the six-feet gate's decision, as a pure function (2026-10-15, UI v3 W0b).
 *
 * tests/e2e/visible-transformation-v3.spec.ts measures a render (ink coverage,
 * registered distance from the frozen v2 baseline) and hands the numbers here;
 * this file decides. It lives apart from the spec so tests/repo/v3-gate.test.ts
 * can pin the decision with no browser, and the spec cannot grow a looser
 * private copy of it.
 *
 * The two thresholds are the v2 gate's, mirrored from
 * tests/e2e/visible-transformation.spec.ts (which stays untouched). Mirrored,
 * not imported: that file is a Playwright spec, and importing a spec registers
 * its tests. tests/repo/v3-gate.test.ts reads the v2 source and fails if either
 * value drifts, so there is still ONE place to change them.
 */

/** The registered ink-mass distance a page must have moved from its v2 baseline. */
export const MIN_DISTANCE = 0.35;
/** A rendered page has ink; a void screen or a bare error line does not. */
export const MIN_INK = 0.012;

export interface GateInput {
  baselineExists: boolean;
  /** Share of non-near-black pixels in the fresh render (inkCoverage). */
  ink: number;
  /** Registered ink-mass distance, fresh render vs baseline (visualDistance().ratio). */
  distance: number;
}

export interface GateVerdict {
  ok: boolean;
  reason: string;
}

/**
 * Order matters and mirrors v2: a missing baseline is a hard failure, never a
 * silent pass; a void render is "far" from everything, so ink is checked before
 * distance; looking the same is the failure. Written as `!(x > y)` so a NaN
 * (an unmeasurable render) fails instead of slipping through a `<` test.
 */
export function v3GateVerdict(input: GateInput): GateVerdict {
  if (!input.baselineExists) {
    return {
      ok: false,
      reason: "missing baseline: capture it with the capture_v3_baselines workflow run, never write it silently",
    };
  }
  if (!(input.ink > MIN_INK)) {
    return {
      ok: false,
      reason: `render carries too little ink to be a page (${input.ink.toFixed(3)}, need > ${MIN_INK})`,
    };
  }
  if (!(input.distance >= MIN_DISTANCE)) {
    return {
      ok: false,
      reason: `still looks like v2: ink-mass distance ${(input.distance * 100).toFixed(1)}% (need >= ${MIN_DISTANCE * 100}%)`,
    };
  }
  return { ok: true, reason: `distance ${(input.distance * 100).toFixed(1)}%` };
}

/**
 * A baseline captured from a blank page would be "far" from every real render
 * and make the gate pass for free. Capture mode therefore refuses a void render.
 */
export function captureVerdict(input: { ink: number }): GateVerdict {
  if (!(input.ink > MIN_INK)) {
    return {
      ok: false,
      reason: `capture refused: render carries too little ink to be a baseline (${input.ink.toFixed(3)}, need > ${MIN_INK})`,
    };
  }
  return { ok: true, reason: "capturable" };
}
