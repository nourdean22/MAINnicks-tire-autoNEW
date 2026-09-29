/**
 * Q-27 · BG/NBD + Gamma-Gamma reference kernel.
 *
 * Pure math only. The default parameters are the rounded CDNOW/lifetimes
 * reference fit recorded in the architecture register. They are an ORACLE/
 * regression fixture, not a Nick's-calibrated production model.
 *
 * Any caller using CDNOW_REFERENCE_PARAMS on Nick's data MUST label the result
 * ranking-only / externally calibrated. This module has no DB, no messaging,
 * no clock, and no side effects.
 */

export interface BgnbdParams {
  r: number;
  alpha: number;
  a: number;
  b: number;
}

export interface GammaGammaParams {
  p: number;
  q: number;
  v: number;
}

export const CDNOW_BGNBD_PARAMS: Readonly<BgnbdParams> = Object.freeze({
  r: 0.243,
  alpha: 4.414,
  a: 0.793,
  b: 2.426,
});

export const CDNOW_GAMMA_GAMMA_PARAMS: Readonly<GammaGammaParams> = Object.freeze({
  p: 6.25,
  q: 3.74,
  v: 15.45,
});

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and >= 0`);
  }
  return value;
}

function assertBgnbd(params: BgnbdParams): void {
  if (!(params.r > 0 && params.alpha > 0 && params.a > 0 && params.b > 0)) {
    throw new Error("BG/NBD parameters must all be > 0");
  }
}

function assertGammaGamma(params: GammaGammaParams): void {
  if (!(params.p > 0 && params.q > 1 && params.v > 0)) {
    throw new Error("Gamma-Gamma requires p>0, q>1, v>0");
  }
}

/**
 * Gauss hypergeometric 2F1(a,b;c;z), via the power series.
 * Q-27's BG/NBD use has z=t/(alpha+T+t), so 0 <= z < 1.
 */
export function hypergeometric2F1(
  a: number,
  b: number,
  c: number,
  z: number,
  tolerance = 1e-12,
  maxIterations = 20_000,
): number {
  if (![a, b, c, z].every(Number.isFinite)) throw new Error("2F1 inputs must be finite");
  if (c === 0 || (c < 0 && Number.isInteger(c))) throw new Error("2F1 c is singular");
  if (z < 0 || z >= 1) throw new Error("2F1 series requires 0 <= z < 1 in this kernel");
  if (z === 0) return 1;

  let sum = 1;
  let term = 1;
  for (let n = 1; n <= maxIterations; n++) {
    term *= ((a + n - 1) * (b + n - 1) * z) / ((c + n - 1) * n);
    sum += term;
    if (!Number.isFinite(sum)) throw new Error("2F1 diverged");
    if (Math.abs(term) <= tolerance * Math.max(1, Math.abs(sum))) return sum;
  }
  throw new Error("2F1 failed to converge within iteration limit");
}

/** Conditional probability a customer is still alive under BG/NBD. */
export function bgnbdProbabilityAlive(input: {
  frequency: number;
  recency: number;
  T: number;
  params?: BgnbdParams;
}): number {
  const x = finiteNonNegative(input.frequency, "frequency");
  const tx = finiteNonNegative(input.recency, "recency");
  const T = finiteNonNegative(input.T, "T");
  const p = input.params ?? CDNOW_BGNBD_PARAMS;
  assertBgnbd(p);
  if (tx > T) throw new Error("recency cannot exceed T");
  if (x === 0) return 1;

  const ratio = Math.pow((p.alpha + T) / (p.alpha + tx), p.r + x);
  return 1 / (1 + (p.a / (p.b + x - 1)) * ratio);
}

/**
 * Conditional expected repeat purchases over the next t time units.
 * Formula matches lifetimes BetaGeoFitter's conditional expectation.
 */
export function bgnbdExpectedPurchases(input: {
  horizon: number;
  frequency: number;
  recency: number;
  T: number;
  params?: BgnbdParams;
}): number {
  const t = finiteNonNegative(input.horizon, "horizon");
  const x = finiteNonNegative(input.frequency, "frequency");
  const tx = finiteNonNegative(input.recency, "recency");
  const T = finiteNonNegative(input.T, "T");
  const p = input.params ?? CDNOW_BGNBD_PARAMS;
  assertBgnbd(p);
  if (tx > T) throw new Error("recency cannot exceed T");
  if (t === 0) return 0;
  if (Math.abs(p.a - 1) < 1e-12) {
    throw new Error("BG/NBD expected-purchase formula is singular at a = 1");
  }

  const z = t / (p.alpha + T + t);
  const hyp = hypergeometric2F1(
    p.r + x,
    p.a + p.b + x - 1,
    p.b + x,
    z,
  );
  const numerator =
    ((p.a + p.b + x - 1) / (p.a - 1)) *
    (1 -
      Math.pow((p.alpha + T) / (p.alpha + T + t), p.r + x) *
        hyp);
  const denominator =
    x > 0
      ? 1 +
        (p.a / (p.b + x - 1)) *
          Math.pow((p.alpha + T) / (p.alpha + tx), p.r + x)
      : 1;
  return Math.max(0, numerator / denominator);
}

/** Population mean transaction value under Gamma-Gamma. */
export function gammaGammaPopulationMean(
  params: GammaGammaParams = CDNOW_GAMMA_GAMMA_PARAMS,
): number {
  assertGammaGamma(params);
  return (params.p * params.v) / (params.q - 1);
}

/** Conditional expected average transaction value. */
export function gammaGammaExpectedAverageValue(input: {
  frequency: number;
  monetaryValue: number;
  params?: GammaGammaParams;
}): number {
  const x = finiteNonNegative(input.frequency, "frequency");
  const m = finiteNonNegative(input.monetaryValue, "monetaryValue");
  const p = input.params ?? CDNOW_GAMMA_GAMMA_PARAMS;
  assertGammaGamma(p);

  const populationMean = gammaGammaPopulationMean(p);
  if (x === 0) return populationMean;
  const individualWeight = (p.p * x) / (p.p * x + p.q - 1);
  return (1 - individualWeight) * populationMean + individualWeight * m;
}

/**
 * Ranking-only composite. Units are the caller's monetary units × expected
 * repeat purchases. It is NOT discounted CLV and must not be labelled revenue.
 */
export function customerValueRankingScore(input: {
  horizon: number;
  frequency: number;
  recency: number;
  T: number;
  monetaryValue: number;
  bgnbd?: BgnbdParams;
  gammaGamma?: GammaGammaParams;
}): {
  probabilityAlive: number;
  expectedPurchases: number;
  expectedAverageValue: number;
  score: number;
} {
  const probabilityAlive = bgnbdProbabilityAlive({
    frequency: input.frequency,
    recency: input.recency,
    T: input.T,
    params: input.bgnbd,
  });
  const expectedPurchases = bgnbdExpectedPurchases({
    horizon: input.horizon,
    frequency: input.frequency,
    recency: input.recency,
    T: input.T,
    params: input.bgnbd,
  });
  const expectedAverageValue = gammaGammaExpectedAverageValue({
    frequency: input.frequency,
    monetaryValue: input.monetaryValue,
    params: input.gammaGamma,
  });
  return {
    probabilityAlive,
    expectedPurchases,
    expectedAverageValue,
    score: expectedPurchases * expectedAverageValue,
  };
}
