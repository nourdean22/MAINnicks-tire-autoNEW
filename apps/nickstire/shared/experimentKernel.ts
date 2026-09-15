/**
 * Experiment kernel — the rules from shared/contentExperiments.ts, generalised
 * off Instagram so a WEB experiment (a headline, a CTA subline, a price
 * hierarchy) is judged by the same discipline as a reel experiment:
 *
 *   1. ONE PRIMARY VARIABLE — arms that differ on anything else are refused.
 *   2. A VERDICT NEEDS ENOUGH DATA — below the floor, `insufficient_data`.
 *   3. NO SIGNAL IS A RESULT — all-zero arms are not ranked.
 *
 * plus the two things a low-traffic public site needs that reels did not:
 *
 *   4. SEQUENTIAL, NOT FIXED-HORIZON. The resolver reads the experiment
 *      daily. A fixed-horizon test peeked daily inflates false positives
 *      (five peeks: ~5% -> ~26%). The mixture Sequential Probability Ratio
 *      Test (mSPRT; Johari, Pekelis & Walsh 2017, as used by Optimizely and
 *      Statsig) yields an ALWAYS-VALID p-value: P(any day's p <= alpha | no
 *      effect) <= alpha, by Ville's inequality. Peeking becomes legitimate
 *      instead of forbidden.
 *   5. SAMPLE-RATIO MISMATCH. Deterministic assignment should split traffic
 *      evenly. If it visibly does not, the randomisation is broken and the
 *      result is meaningless — refused as `invalid_design`, never explained
 *      away.
 *
 * Pure and browser-safe (client assignment imports assignByKey). No DB, no
 * network — the resolver supplies counts and persists verdicts.
 */

// ---------------------------------------------------------------------------
// Confound detection — the generic form of contentExperiments.findConfounds
// ---------------------------------------------------------------------------

/**
 * Field names on which the arms differ, excluding the one the experiment is
 * allowed to vary. Empty means the design is interpretable.
 */
export function findConfoundsIn<T extends Record<string, unknown>>(
  arms: readonly T[],
  controlledFields: readonly (keyof T & string)[],
  exemptField: keyof T & string,
): string[] {
  const confounds: string[] = [];
  for (const field of controlledFields) {
    if (field === exemptField) continue;
    const values = new Set(arms.map((a) => JSON.stringify(a[field] ?? null)));
    if (values.size > 1) confounds.push(field);
  }
  return confounds;
}

// ---------------------------------------------------------------------------
// Assignment — same hash as contentExperiments.assignArm, so an episode key
// lands in the same arm whichever module derives it.
// ---------------------------------------------------------------------------

export function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic: the same key always yields the same arm. */
export function assignByKey(armIds: readonly string[], key: string): string {
  if (armIds.length === 0) throw new Error("assignByKey: no arms");
  return armIds[hashKey(key) % armIds.length];
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface BinomialCounts {
  /** Distinct exposed units (sessions). */
  exposures: number;
  /** Distinct exposed units that converted. */
  conversions: number;
}

export interface SequentialResult {
  /** Always-valid p-value from the mSPRT likelihood ratio. */
  pValue: number;
  /** The mixture likelihood ratio Lambda_n itself. */
  lambda: number;
  controlRate: number;
  variantRate: number;
  /** Absolute difference variant - control. */
  delta: number;
  /** Relative lift vs control; null when control rate is 0. */
  lift: number | null;
}

export interface SequentialOptions {
  /**
   * Mixing standard deviation of the effect prior, in ABSOLUTE rate units.
   * 0.02 means "effects on the order of two percentage points" — the scale a
   * CTA change on a page converting at 3-10% can plausibly move. Too small
   * and the test is slow to detect real effects; too large and it is slow to
   * detect small ones. It does NOT affect validity, only power.
   */
  tau?: number;
}

/**
 * Two-sample mSPRT for conversion rates.
 *
 *   theta_hat = p_v - p_c
 *   V         = p_bar (1 - p_bar) (1/n_c + 1/n_v)        (pooled variance of theta_hat)
 *   Lambda    = sqrt(V / (V + tau^2)) * exp(tau^2 theta_hat^2 / (2 V (V + tau^2)))
 *   p         = min(1, 1 / Lambda)
 *
 * When every unit did or did not convert, V is 0 and there is no likelihood
 * ratio to form; the caller sees p = 1 (no evidence), never a divide-by-zero.
 */
export function mSprt(control: BinomialCounts, variant: BinomialCounts, opts: SequentialOptions = {}): SequentialResult {
  const tau = opts.tau ?? 0.02;
  const nc = Math.max(0, control.exposures);
  const nv = Math.max(0, variant.exposures);
  const xc = Math.min(Math.max(0, control.conversions), nc);
  const xv = Math.min(Math.max(0, variant.conversions), nv);
  const controlRate = nc > 0 ? xc / nc : 0;
  const variantRate = nv > 0 ? xv / nv : 0;
  const delta = variantRate - controlRate;
  const lift = controlRate > 0 ? delta / controlRate : null;

  if (nc === 0 || nv === 0) return { pValue: 1, lambda: 1, controlRate, variantRate, delta, lift };
  const pooled = (xc + xv) / (nc + nv);
  const sigma2 = pooled * (1 - pooled);
  const V = sigma2 * (1 / nc + 1 / nv);
  if (!(V > 0)) return { pValue: 1, lambda: 1, controlRate, variantRate, delta, lift };

  const t2 = tau * tau;
  const lambda = Math.sqrt(V / (V + t2)) * Math.exp((t2 * delta * delta) / (2 * V * (V + t2)));
  const pValue = Math.min(1, 1 / lambda);
  return { pValue, lambda, controlRate, variantRate, delta, lift };
}

/** Regularised upper incomplete gamma Q(a, x) — Numerical Recipes gser/gcf. */
function lnGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export function upperIncompleteGammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    // series for P, Q = 1 - P
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    const P = sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
    return Math.max(0, Math.min(1, 1 - P));
  }
  // continued fraction for Q
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h));
}

/** Survival function of the chi-square distribution: P(X > chi2). */
export function chiSquareSurvival(chi2: number, df: number): number {
  if (df <= 0) return 1;
  return upperIncompleteGammaQ(df / 2, chi2 / 2);
}

export interface SrmResult {
  ok: boolean;
  chiSquare: number;
  pValue: number;
  note: string;
}

/**
 * Sample-ratio mismatch: chi-square goodness of fit of exposure counts
 * against the intended allocation (equal by default). p < 0.001 is the
 * conventional alarm — at that level a mismatch is a broken randomiser, not
 * bad luck. Below 100 total exposures the test has no power and reports ok.
 */
export function srmCheck(exposures: readonly number[], expectedShares?: readonly number[]): SrmResult {
  const k = exposures.length;
  const total = exposures.reduce((a, b) => a + b, 0);
  const shares = expectedShares ?? exposures.map(() => 1 / k);
  if (k < 2 || total < 100) return { ok: true, chiSquare: 0, pValue: 1, note: "too few exposures to test the split" };
  let chi = 0;
  for (let i = 0; i < k; i++) {
    const expected = total * shares[i];
    if (expected <= 0) continue;
    chi += ((exposures[i] - expected) ** 2) / expected;
  }
  const p = chiSquareSurvival(chi, k - 1);
  return {
    ok: p >= 0.001,
    chiSquare: chi,
    pValue: p,
    note: p >= 0.001 ? "split matches the intended allocation" : `split is off (p=${p.toExponential(2)}) — randomisation or exposure logging is broken`,
  };
}

// ---------------------------------------------------------------------------
// Web experiment evaluation
// ---------------------------------------------------------------------------

export type MetricDirection = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";

export interface WebExperimentArm {
  armId: string;
  variantValue: string;
  /** Every other field an arm is allowed to declare must be identical across arms. */
  [controlled: string]: unknown;
}

export interface GuardrailSpec {
  /** customer_events eventName counted per exposed session. */
  metric: string;
  direction: MetricDirection;
}

export interface WebExperimentDefinition {
  experimentId: string;
  /** The single thing that differs between arms. */
  primaryVariable: string;
  /** customer_events eventName counted per exposed session. */
  primaryMetric: string;
  /** Held-out harm metrics. A variant that significantly WORSENS one is refused even if the primary wins. */
  guardrails: GuardrailSpec[];
  arms: [WebExperimentArm, WebExperimentArm];
  /** ISO time the definition was frozen. The definition is code; its hash is the pre-registration. */
  preregisteredAt: string;
  /** Route(s) the experiment touches — checked against the goal contract by tests. */
  surfaces: string[];
}

export interface ArmMetricCounts {
  armId: string;
  exposures: number;
  /** eventName -> distinct exposed sessions that fired it. */
  conversions: Record<string, number>;
}

export type WebExperimentVerdict =
  | { status: "invalid_design"; note: string }
  | { status: "insufficient_data"; needed: number; have: number; note: string }
  | { status: "no_signal"; note: string }
  | { status: "keep_running"; note: string; primary: SequentialResult }
  | { status: "guardrail_breach"; metric: string; note: string; primary: SequentialResult; guardrail: SequentialResult }
  | { status: "winner"; armId: string; variantValue: string; note: string; primary: SequentialResult };

export interface EvaluateOptions extends SequentialOptions {
  alpha?: number;
  /** Floor before any sequential read is trusted; the variance estimate is unstable below it. */
  minExposuresPerArm?: number;
}

export const DEFAULT_MIN_EXPOSURES_PER_ARM = 50;
export const DEFAULT_ALPHA = 0.05;

/** The arm whose armId is "control" is control; otherwise the first arm. */
export function controlArm(def: WebExperimentDefinition): WebExperimentArm {
  return def.arms.find((a) => a.armId === "control") ?? def.arms[0];
}

export function evaluateWebExperiment(
  def: WebExperimentDefinition,
  counts: ArmMetricCounts[],
  opts: EvaluateOptions = {},
): WebExperimentVerdict {
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  const floor = opts.minExposuresPerArm ?? DEFAULT_MIN_EXPOSURES_PER_ARM;

  if (def.arms.length !== 2) return { status: "invalid_design", note: "the kernel evaluates exactly two arms (control + one variant)" };
  const controlled = Object.keys(Object.assign({}, ...def.arms)).filter((k) => k !== "armId" && k !== "variantValue");
  const confounds = findConfoundsIn(def.arms, controlled, def.primaryVariable);
  if (confounds.length) {
    return { status: "invalid_design", note: `arms differ on ${confounds.join(", ")} as well as ${def.primaryVariable} — no result could be attributed` };
  }

  const control = controlArm(def);
  const variant = def.arms.find((a) => a.armId !== control.armId)!;
  const cc = counts.find((c) => c.armId === control.armId) ?? { armId: control.armId, exposures: 0, conversions: {} };
  const vc = counts.find((c) => c.armId === variant.armId) ?? { armId: variant.armId, exposures: 0, conversions: {} };

  const srm = srmCheck([cc.exposures, vc.exposures]);
  if (!srm.ok) return { status: "invalid_design", note: `sample ratio mismatch: ${srm.note}` };

  const thinnest = Math.min(cc.exposures, vc.exposures);
  if (thinnest < floor) {
    return { status: "insufficient_data", needed: floor, have: thinnest, note: `need ${floor} exposed sessions per arm; the thinnest arm has ${thinnest}` };
  }

  const primaryC = { exposures: cc.exposures, conversions: cc.conversions[def.primaryMetric] ?? 0 };
  const primaryV = { exposures: vc.exposures, conversions: vc.conversions[def.primaryMetric] ?? 0 };
  if (primaryC.conversions === 0 && primaryV.conversions === 0) {
    return { status: "no_signal", note: `no exposed session in either arm fired ${def.primaryMetric} — nothing to rank` };
  }

  const primary = mSprt(primaryC, primaryV, opts);

  // Guardrails are read at the same always-valid threshold. A harm on a
  // held-out metric refuses the win: the primary metric is the one an
  // optimiser can game, the guardrail is the one it cannot.
  for (const g of def.guardrails) {
    const gr = mSprt(
      { exposures: cc.exposures, conversions: cc.conversions[g.metric] ?? 0 },
      { exposures: vc.exposures, conversions: vc.conversions[g.metric] ?? 0 },
      opts,
    );
    const worse = g.direction === "HIGHER_IS_BETTER" ? gr.delta < 0 : gr.delta > 0;
    if (worse && gr.pValue < alpha) {
      return {
        status: "guardrail_breach",
        metric: g.metric,
        note: `variant significantly worsens ${g.metric} (${(gr.controlRate * 100).toFixed(1)}% -> ${(gr.variantRate * 100).toFixed(1)}%, p=${gr.pValue.toExponential(2)}); refused regardless of the primary metric`,
        primary,
        guardrail: gr,
      };
    }
  }

  if (primary.pValue < alpha) {
    const winnerArm = primary.delta > 0 ? variant : control;
    return {
      status: "winner",
      armId: winnerArm.armId,
      variantValue: winnerArm.variantValue,
      note: `${def.primaryVariable}=${winnerArm.variantValue} leads on ${def.primaryMetric} (${(primary.controlRate * 100).toFixed(1)}% vs ${(primary.variantRate * 100).toFixed(1)}%, always-valid p=${primary.pValue.toExponential(2)})`,
      primary,
    };
  }

  return {
    status: "keep_running",
    note: `no decision yet on ${def.primaryMetric}: ${(primary.controlRate * 100).toFixed(1)}% vs ${(primary.variantRate * 100).toFixed(1)}%, always-valid p=${primary.pValue.toFixed(3)} (alpha ${alpha})`,
    primary,
  };
}
