/**
 * Second-Location Feasibility Model · v10.0.526 · Arc C · Feature 7
 *
 * PURE-FUNCTION scorer. Given an address + 5 measured dimensions it
 * returns a 0-100 score, a tier (A/B/C/D/F), the strongest +
 * weakest dimensions, and English reasoning the operator can act on.
 *
 * Why pure functions: data sources (foot-traffic API · Yelp scrape ·
 * municipal zoning portal · Google distance matrix) are NOT in this
 * commit. The operator hasn't picked vendors yet. Decoupling math
 * from ingestion means the algorithm is deterministic, unit-testable,
 * and ready the day data arrives. Persistence (rankings) happens one
 * layer up in location-rank.ts.
 *
 * Dimension contracts (all OPTIONAL · missing = neutral 0.5):
 *   footTrafficPercentile   0-100 · higher = better
 *   reviewDensity           reviews per nearby competitor · higher = better
 *   competitorCluster       count of auto-repair shops within 2mi ·
 *                           LOWER is better (inverted before weighting)
 *   driveTimeToHomeMinutes  drive time to Euclid HQ · LOWER is better
 *                           (operator can supervise) · capped at 60min
 *   zoningFriction          0-100 · estimated municipal hassle ·
 *                           LOWER is better
 *
 * Weights (sum to 1.0):
 *   footTraffic       0.30
 *   reviewDensity     0.20
 *   competitorCluster 0.20
 *   driveTime         0.15
 *   zoningFriction    0.15
 *
 * Tiering (normalizedScore):
 *   A · 85-100 · ship · matches/beats current shop
 *   B · 70-84  · strong · worth deeper diligence
 *   C · 50-69  · marginal · would need 2+ dimensions to improve
 *   D · 35-49  · weak · multiple red flags
 *   F · 0-34   · don't · or reconsider parameters
 *
 * The all-neutral (no-data) case lands at 50/100 → tier C. That's
 * intentional · "we know nothing" should not look identical to
 * "we measured and it's bad." Operator gets a warning instead.
 *
 * Operator-facing: the `reasoning` field MUST be human readable. The
 * model is decision-support, not auto-decision; explanations win.
 */

export interface LocationParams {
  address: string;
  footTrafficPercentile?: number;
  reviewDensity?: number;
  competitorCluster?: number;
  driveTimeToHomeMinutes?: number;
  zoningFriction?: number;
}

export type LocationTier = "A" | "B" | "C" | "D" | "F";

export type LocationDimension =
  | "footTraffic"
  | "reviewDensity"
  | "competitorCluster"
  | "driveTime"
  | "zoningFriction";

export interface LocationScore {
  address: string;
  rawScore: number; // 0-1 weighted sum
  normalizedScore: number; // 0-100 integer
  tier: LocationTier;
  reasoning: string[];
  weakestDimension: LocationDimension | null;
  strongestDimension: LocationDimension | null;
  dimensions: Record<LocationDimension, { provided: boolean; normalized: number; weight: number }>;
  warnings: string[];
}

/**
 * Default weights. Exposed so callers (tests · future tuner cron)
 * can override without forking the scorer. Keep summing to 1.0.
 */
export const DEFAULT_WEIGHTS: Record<LocationDimension, number> = {
  footTraffic: 0.3,
  reviewDensity: 0.2,
  competitorCluster: 0.2,
  driveTime: 0.15,
  zoningFriction: 0.15,
};

/**
 * Clamp helper · pinch a numeric input into [min, max]. Inlined
 * intentionally · the whole scorer is < 200 lines, importing
 * lodash.clamp would be silly.
 */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Normalize each dimension to a 0-1 "higher is better" scale.
 *
 * footTraffic   · already 0-100 · /100
 * reviewDensity · log-scaled (saturates after ~20 reviews/competitor) ·
 *                 reviews near 0 → ~0, reviews near 20 → ~1.0
 * competitorCluster · INVERTED · 0 competitors = 1.0 (best),
 *                     >= 10 competitors = 0.0 (saturated bad)
 * driveTime · INVERTED · 0 min = 1.0, capped at 60 min = 0.0
 * zoningFriction · already 0-100 · INVERTED · (100 - z) / 100
 *
 * When a dimension is MISSING the function returns 0.5 (neutral).
 * That keeps an under-measured candidate from looking artificially
 * great OR artificially terrible · the operator sees a warning so
 * they know what to collect next.
 */
export function normalizeDimensions(params: LocationParams): {
  values: Record<LocationDimension, number>;
  provided: Record<LocationDimension, boolean>;
} {
  const provided: Record<LocationDimension, boolean> = {
    footTraffic: typeof params.footTrafficPercentile === "number",
    reviewDensity: typeof params.reviewDensity === "number",
    competitorCluster: typeof params.competitorCluster === "number",
    driveTime: typeof params.driveTimeToHomeMinutes === "number",
    zoningFriction: typeof params.zoningFriction === "number",
  };

  const ft = provided.footTraffic
    ? clamp(params.footTrafficPercentile! / 100, 0, 1)
    : 0.5;

  // reviewDensity uses a log curve · diminishing returns past 20.
  // log(1 + x) / log(1 + 20) gives a 0-1 curve over [0, 20+].
  const rdRaw = provided.reviewDensity ? Math.max(0, params.reviewDensity!) : null;
  const rd = rdRaw === null ? 0.5 : clamp(Math.log(1 + rdRaw) / Math.log(1 + 20), 0, 1);

  // competitorCluster · inverted · 0 competitors = ideal, 10+ = saturated.
  const ccRaw = provided.competitorCluster ? Math.max(0, params.competitorCluster!) : null;
  const cc = ccRaw === null ? 0.5 : clamp(1 - ccRaw / 10, 0, 1);

  // driveTime · inverted · 0 minutes = ideal, 60min cap.
  const dtRaw = provided.driveTime
    ? Math.max(0, params.driveTimeToHomeMinutes!)
    : null;
  const dt = dtRaw === null ? 0.5 : clamp(1 - dtRaw / 60, 0, 1);

  // zoningFriction · 0-100 score · inverted.
  const zf = provided.zoningFriction
    ? clamp(1 - params.zoningFriction! / 100, 0, 1)
    : 0.5;

  return {
    values: {
      footTraffic: ft,
      reviewDensity: rd,
      competitorCluster: cc,
      driveTime: dt,
      zoningFriction: zf,
    },
    provided,
  };
}

/**
 * Tier thresholds. Pure function · kept separate so a future tuner
 * cron can adjust without touching the scoring path.
 */
export function tierFor(normalizedScore: number): LocationTier {
  if (normalizedScore >= 85) return "A";
  if (normalizedScore >= 70) return "B";
  if (normalizedScore >= 50) return "C";
  if (normalizedScore >= 35) return "D";
  return "F";
}

/**
 * Human-readable label for a dimension · used in reasoning strings.
 */
export function labelOf(dim: LocationDimension): string {
  switch (dim) {
    case "footTraffic":
      return "foot-traffic percentile";
    case "reviewDensity":
      return "review density vs competitors";
    case "competitorCluster":
      return "competitor cluster (lower is better)";
    case "driveTime":
      return "drive time to Euclid HQ (lower is better)";
    case "zoningFriction":
      return "zoning friction (lower is better)";
  }
}

/**
 * The main scorer. Pure · no DB · no fetch · no Date.now() use.
 * Deterministic for identical input.
 */
export function scoreLocation(
  params: LocationParams,
  weights: Record<LocationDimension, number> = DEFAULT_WEIGHTS,
): LocationScore {
  const { values, provided } = normalizeDimensions(params);

  // Weighted sum · uses the active weight per dimension regardless of
  // whether data was provided. Missing dims contribute 0.5 · weight,
  // which neither helps nor hurts disproportionately.
  let rawScore = 0;
  for (const dim of Object.keys(values) as LocationDimension[]) {
    rawScore += values[dim] * weights[dim];
  }
  rawScore = clamp(rawScore, 0, 1);
  const normalizedScore = Math.round(rawScore * 100);
  const tier = tierFor(normalizedScore);

  // Find strongest + weakest dimensions · weighted contribution, so a
  // strong score on a low-weight axis doesn't win. Skip missing dims
  // (they're neutral by definition).
  let strongest: LocationDimension | null = null;
  let strongestWeighted = -Infinity;
  let weakest: LocationDimension | null = null;
  let weakestWeighted = Infinity;
  for (const dim of Object.keys(values) as LocationDimension[]) {
    if (!provided[dim]) continue;
    const w = values[dim] * weights[dim];
    if (w > strongestWeighted) {
      strongestWeighted = w;
      strongest = dim;
    }
    if (w < weakestWeighted) {
      weakestWeighted = w;
      weakest = dim;
    }
  }

  // Build the operator-facing reasoning. Order: headline · strongest
  // · weakest · tier guidance · explicit missing-data calls. This is
  // the layer that makes the model useful — explanations matter as
  // much as the score.
  const reasoning: string[] = [];
  reasoning.push(
    `${params.address} · scored ${normalizedScore}/100 · tier ${tier}`,
  );

  if (strongest) {
    reasoning.push(
      `Strongest: ${labelOf(strongest)} (${(values[strongest] * 100).toFixed(0)}/100 normalized).`,
    );
  }
  if (weakest && weakest !== strongest) {
    reasoning.push(
      `Weakest: ${labelOf(weakest)} (${(values[weakest] * 100).toFixed(0)}/100 normalized). Improving this would lift the overall score most.`,
    );
  }

  switch (tier) {
    case "A":
      reasoning.push("Tier A · ship-ready. Proceed to financial diligence + lease negotiation.");
      break;
    case "B":
      reasoning.push("Tier B · strong candidate. Worth a site visit and operator interview before committing.");
      break;
    case "C":
      reasoning.push("Tier C · marginal. Two or more dimensions would need to improve before this is the right move.");
      break;
    case "D":
      reasoning.push("Tier D · weak. Multiple red flags · most candidates in this band should be deprioritized.");
      break;
    case "F":
      reasoning.push("Tier F · do not pursue · or revisit input parameters · the data shows no edge here.");
      break;
  }

  // Missing-data warnings · we keep these distinct from reasoning so
  // the operator can tell "we lack info" from "we scored low".
  const warnings: string[] = [];
  const missing = (Object.keys(provided) as LocationDimension[])
    .filter((d) => !provided[d])
    .map(labelOf);
  if (missing.length > 0) {
    warnings.push(
      `Missing data on: ${missing.join(", ")}. Each missing dimension was scored neutrally (0.5) · the real score may differ once collected.`,
    );
  }

  const dimensions = (Object.keys(values) as LocationDimension[]).reduce(
    (acc, dim) => {
      acc[dim] = {
        provided: provided[dim],
        normalized: Number(values[dim].toFixed(4)),
        weight: weights[dim],
      };
      return acc;
    },
    {} as LocationScore["dimensions"],
  );

  return {
    address: params.address,
    rawScore: Number(rawScore.toFixed(4)),
    normalizedScore,
    tier,
    reasoning,
    weakestDimension: weakest,
    strongestDimension: strongest,
    dimensions,
    warnings,
  };
}

/**
 * Slug an address for BrainMemory keys · lowercase · alphanum +
 * hyphens · capped at 120 chars. The key is `addr_<slug>` and the
 * caller is location-rank.ts (it persists rankings, not individual
 * scores · scoreLocation itself remains pure).
 */
export function addressSlug(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
