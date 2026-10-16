/**
 * v3-gate · the six-feet gate's decision, as a pure function (2026-10-15, UI v3 W0b).
 *
 * tests/e2e/visible-transformation-v3.spec.ts renders a page and hands the PNGs
 * to measureAndJudge, which measures (ink coverage, registered distance from the
 * frozen v2 baseline) through injectable deps and decides with v3GateVerdict.
 * Both live apart from the spec so tests/repo/v3-gate.test.ts can pin the whole
 * path with stub deps and no browser, and the spec holds no arithmetic of its
 * own to loosen.
 *
 * The two thresholds are the v2 gate's, mirrored from
 * tests/e2e/visible-transformation.spec.ts (which stays untouched). Mirrored,
 * not imported: that file is a Playwright spec, and importing a spec registers
 * its tests. So there are two copies; tests/repo/v3-gate.test.ts reads the v2
 * source and fails if either value drifts, which is what keeps them one.
 */
import { inkCoverage as realInkCoverage, visualDistance as realVisualDistance } from "./visual-distance";

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

export interface Viewport {
  width: number;
  height: number;
}

export interface MeasureDeps {
  inkCoverage: (png: Buffer, viewport: Viewport) => Promise<number>;
  visualDistance: (a: Buffer, b: Buffer, viewport: Viewport) => Promise<{ ratio: number }>;
}

export interface Measurement {
  ink: number;
  /** NaN when there is no baseline to measure against. */
  distance: number;
  verdict: GateVerdict;
}

const REAL_DEPS: MeasureDeps = { inkCoverage: realInkCoverage, visualDistance: realVisualDistance };

/**
 * Measure a fresh render against its baseline and decide. The ONLY path the v3
 * spec uses: the ink is always measured (never assumed), the distance is
 * measured only when a baseline exists and is NaN otherwise (never a stand-in
 * number), and the verdict is v3GateVerdict over exactly those numbers.
 */
export async function measureAndJudge(
  input: { baseline: Buffer | null; current: Buffer; viewport: Viewport },
  deps: MeasureDeps = REAL_DEPS,
): Promise<Measurement> {
  const ink = await deps.inkCoverage(input.current, input.viewport);
  const distance = input.baseline ? (await deps.visualDistance(input.baseline, input.current, input.viewport)).ratio : Number.NaN;
  const verdict = v3GateVerdict({ baselineExists: input.baseline !== null, ink, distance });
  return { ink, distance, verdict };
}
