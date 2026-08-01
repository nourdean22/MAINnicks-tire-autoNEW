/**
 * Content experiment registry — what changed, what happened, and whether the
 * difference means anything.
 *
 * Pure core by design (assignment + evaluation take data and return verdicts,
 * no DB, no network) so the rules below are testable rather than asserted.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE TWO RULES THAT MAKE THIS WORTH HAVING
 *
 * 1. ONE PRIMARY VARIABLE. An experiment that changes the hook AND the CTA AND
 *    the posting slot teaches nothing — whatever happens, you cannot say which
 *    change caused it. `primaryVariable` is declared up front and the evaluator
 *    refuses a verdict if the arms differ on anything else.
 *
 * 2. A VERDICT REQUIRES ENOUGH DATA TO SUPPORT ONE. The account's two
 *    best-performing reels sit at n=1 per posting slot, which is exactly the
 *    kind of number that reads as a finding and is noise. Below
 *    MIN_SAMPLES_PER_ARM the evaluator returns `insufficient_data` and names
 *    what it would need. It never picks a winner to be helpful.
 *
 * COLD START: this account measures saved = 0.00 across every reel it has
 * posted. A saves-ranked objective therefore has NO GRADIENT — every arm ties
 * at zero and any "winner" is arbitrary. `evaluateExperiment` detects the
 * all-zero case explicitly and reports `no_signal` rather than ranking noise.
 */
import type { CtaType, ContentDistributionObjective } from "./instagramStudio";
import type { FranchiseId } from "./contentFranchises";
import type { ContentOrigin } from "./instagramStudio";

export const EXPERIMENT_REGISTRY_VERSION = "content-experiments-v1" as const;

/** Below this many posts per arm, no verdict is issued. */
export const MIN_SAMPLES_PER_ARM = 4;

/**
 * HOW A METRIC COMBINES ACROSS POSTS — declared, never assumed.
 *
 * The first version of this file divided EVERY metric by reach. That is right
 * for a count (20 shares off 1,000 reach beats 20 off 5,000) and wrong for
 * anything already normalised: dividing an average watch time of 3.0s by a
 * reach of 5,000 does not produce a rate, it produces a number that shrinks as
 * an arm reaches more people — so the better-distributed arm loses. Reach
 * itself collapsed to reach/reach = 1 for every arm, i.e. a guaranteed tie.
 *
 * Aggregation is therefore a property of the metric, and an unknown metric is
 * refused rather than guessed at.
 */
export type MetricAggregation =
  /** A count of events; divide by reach to get a rate. */
  | "COUNT_PER_REACH"
  /** Already an average per viewer; average the values, never divide by reach. */
  | "RAW_AVERAGE"
  /** An average whose posts deserve unequal weight; weight by reach. */
  | "WEIGHTED_AVERAGE"
  /** Already a ratio or percentage; average as-is. */
  | "RATIO"
  /** A total that is the outcome itself (reach, views); never divide by reach. */
  | "RAW_TOTAL";

export type MetricDirection = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";

export interface MetricSpec {
  aggregation: MetricAggregation;
  direction: MetricDirection;
}

/**
 * Metric names match the Instagram insight fields the snapshot writer stores.
 * `ig_reels_avg_watch_time` is milliseconds-per-viewer and `reels_skip_rate` is
 * a rate where lower wins — both were previously ranked as if higher-per-reach
 * were better.
 */
const COUNT: MetricSpec = { aggregation: "COUNT_PER_REACH", direction: "HIGHER_IS_BETTER" };

/**
 * Names come from DISTRIBUTION_OBJECTIVE_METRICS — the system's own vocabulary
 * — not from invented ones. The first version registered "shares" while every
 * experiment in the repo declares "shares_per_reach", so the unknown-metric
 * guard rejected the only metric actually in use. A registry that does not
 * cover the declared vocabulary turns a safety check into an outage; the test
 * below asserts coverage rather than trusting this list to stay in sync.
 *
 * `*_per_reach` names describe the OUTPUT, not the input: observations carry a
 * raw count plus reach, and COUNT_PER_REACH is what performs the division.
 */
export const METRIC_SPECS: Record<string, MetricSpec> = {
  // discovery
  avg_watch_time: { aggregation: "WEIGHTED_AVERAGE", direction: "HIGHER_IS_BETTER" },
  skip_rate: { aggregation: "RAW_AVERAGE", direction: "LOWER_IS_BETTER" },
  shares_per_reach: COUNT,
  follows_per_reach: COUNT,
  // utility
  saves_per_reach: COUNT,
  profile_visits_per_reach: COUNT,
  // trust / conversion / community
  dms: COUNT,
  direction_taps: COUNT,
  calls: COUNT,
  profile_link_taps: COUNT,
  booking_actions: COUNT,
  comments: COUNT,
  replies: COUNT,
  poll_participation: COUNT,
  // raw Instagram insight field names, for experiments declared against them
  ig_reels_avg_watch_time: { aggregation: "WEIGHTED_AVERAGE", direction: "HIGHER_IS_BETTER" },
  reels_skip_rate: { aggregation: "RAW_AVERAGE", direction: "LOWER_IS_BETTER" },
  shares: COUNT,
  saved: COUNT,
  likes: COUNT,
  reach: { aggregation: "RAW_TOTAL", direction: "HIGHER_IS_BETTER" },
  views: { aggregation: "RAW_TOTAL", direction: "HIGHER_IS_BETTER" },
};

/** An unregistered metric has no defensible aggregation — say so, don't guess. */
export function metricSpec(name: string): MetricSpec | null {
  return METRIC_SPECS[name] ?? null;
}

/** The single dimension an experiment is allowed to vary. */
export type PrimaryVariable =
  | "hook_style"
  | "cta_type"
  | "posting_slot"
  | "narrative_format"
  | "length_band"
  | "franchise"
  | "voice_mode"
  | "content_origin";

/** Everything recorded about one published episode, so a result can be traced
 *  back to every input that produced it. */
export interface ExperimentArm {
  armId: string;
  /** What this arm sets the primary variable to. */
  variantValue: string;
  franchiseId?: FranchiseId;
  ctaType?: CtaType;
  postingSlot?: string;
  contentOrigin?: ContentOrigin;
  provider?: string;
  model?: string;
  promptVersion?: string;
  // These four are declarable primary variables, so without matching arm fields
  // findConfounds() could not tell whether a hook_style test also moved the
  // narrative format — it would pass an unconfounded verdict on a confounded
  // design. A variable you can name must be a field you can check.
  hookStyle?: string;
  narrativeFormat?: string;
  lengthBand?: string;
  voiceMode?: string;
}

export interface ExperimentDefinition {
  experimentId: string;
  primaryVariable: PrimaryVariable;
  objective: ContentDistributionObjective;
  /** The metric the verdict is decided on. Must belong to the objective. */
  primaryMetric: string;
  arms: ExperimentArm[];
  startedAt: string;
}

/** One post's measured outcome at a snapshot horizon. */
export interface ArmObservation {
  armId: string;
  mediaId: string;
  /** Hours after publish. Snapshots are taken at 24 / 72 / 168. */
  horizonHours: 24 | 72 | 168;
  reach: number | null;
  /** null means NOT REPORTED — never coerce to 0, that fabricates a measurement. */
  metricValue: number | null;
}

export type ExperimentVerdict =
  | { status: "insufficient_data"; needed: number; have: number; note: string }
  | { status: "no_signal"; note: string }
  | { status: "invalid_design"; note: string }
  | { status: "winner"; armId: string; variantValue: string; lift: number; note: string }
  | { status: "tie"; note: string };

/**
 * An experiment is only interpretable if its arms differ on the primary
 * variable and NOTHING ELSE. Returns the confounded field names, if any.
 */
export function findConfounds(def: ExperimentDefinition): string[] {
  const controlled: (keyof ExperimentArm)[] = [
    "franchiseId", "ctaType", "postingSlot", "contentOrigin", "provider", "model", "promptVersion",
    "hookStyle", "narrativeFormat", "lengthBand", "voiceMode",
  ];
  // The field the experiment is legitimately varying is exempt. Every
  // PrimaryVariable must appear here, or its own arm field would be reported as
  // a confound and the experiment could never return a verdict.
  const varying: Record<PrimaryVariable, keyof ExperimentArm> = {
    cta_type: "ctaType",
    posting_slot: "postingSlot",
    franchise: "franchiseId",
    content_origin: "contentOrigin",
    hook_style: "hookStyle",
    narrative_format: "narrativeFormat",
    length_band: "lengthBand",
    voice_mode: "voiceMode",
  };
  const exempt = varying[def.primaryVariable];
  const confounds: string[] = [];
  for (const field of controlled) {
    if (field === exempt) continue;
    const values = new Set(def.arms.map((a) => JSON.stringify(a[field] ?? null)));
    if (values.size > 1) confounds.push(field);
  }
  return confounds;
}

/**
 * Per-arm score on the primary metric, combined according to the metric's own
 * declared aggregation (see METRIC_SPECS). A count becomes a per-reach rate so
 * an arm that merely got more distribution is not credited for it; an average
 * or ratio is combined as an average, because dividing it by reach would
 * penalise the arm that reached more people.
 */
export function armRates(
  def: ExperimentDefinition,
  observations: ArmObservation[],
  horizonHours: 24 | 72 | 168 = 72,
): Map<string, { n: number; rate: number | null; reported: number }> {
  const out = new Map<string, { n: number; rate: number | null; reported: number }>();
  const spec = metricSpec(def.primaryMetric);

  for (const arm of def.arms) {
    const obs = observations.filter((o) => o.armId === arm.armId && o.horizonHours === horizonHours);
    const reported = obs.filter((o) => o.metricValue !== null);
    if (reported.length === 0 || !spec) {
      // No spec means no defensible way to combine — null, not a guessed number.
      out.set(arm.armId, { n: obs.length, rate: null, reported: spec ? 0 : reported.length });
      continue;
    }

    let rate: number;
    if (spec.aggregation === "COUNT_PER_REACH") {
      let sum = 0;
      for (const o of reported) {
        sum += o.reach && o.reach > 0 ? (o.metricValue as number) / o.reach : (o.metricValue as number);
      }
      rate = sum / reported.length;
    } else if (spec.aggregation === "WEIGHTED_AVERAGE") {
      // Weight each post's average by the audience it was averaged over, so a
      // 3.0s average off 5,000 viewers outweighs 3.4s off 40. Falls back to an
      // unweighted mean when reach is unreported rather than dropping the post.
      let num = 0;
      let den = 0;
      for (const o of reported) {
        const w = o.reach && o.reach > 0 ? o.reach : 1;
        num += (o.metricValue as number) * w;
        den += w;
      }
      rate = num / den;
    } else {
      // RAW_AVERAGE, RATIO, RAW_TOTAL — already comparable; mean them.
      let sum = 0;
      for (const o of reported) sum += o.metricValue as number;
      rate = sum / reported.length;
    }

    out.set(arm.armId, { n: obs.length, rate, reported: reported.length });
  }
  return out;
}

/**
 * Decide an experiment. Refuses a verdict rather than manufacturing one —
 * `insufficient_data`, `no_signal` and `invalid_design` are first-class
 * outcomes, not error states.
 */
export function evaluateExperiment(
  def: ExperimentDefinition,
  observations: ArmObservation[],
  horizonHours: 24 | 72 | 168 = 72,
): ExperimentVerdict {
  if (def.arms.length < 2) {
    return { status: "invalid_design", note: "an experiment needs at least two arms" };
  }
  const confounds = findConfounds(def);
  if (confounds.length) {
    return {
      status: "invalid_design",
      note: `arms differ on ${confounds.join(", ")} as well as ${def.primaryVariable} — no result could be attributed`,
    };
  }

  // An unregistered metric has no declared aggregation or direction. Ranking it
  // would mean assuming both — and assuming "higher per reach is better" is
  // exactly the bug this guard replaces.
  const spec = metricSpec(def.primaryMetric);
  if (!spec) {
    return {
      status: "invalid_design",
      note: `"${def.primaryMetric}" has no entry in METRIC_SPECS — register its aggregation and direction before ranking arms on it`,
    };
  }

  const rates = armRates(def, observations, horizonHours);
  const smallest = Math.min(...[...rates.values()].map((r) => r.reported));
  if (smallest < MIN_SAMPLES_PER_ARM) {
    return {
      status: "insufficient_data",
      needed: MIN_SAMPLES_PER_ARM,
      have: smallest,
      note: `need ${MIN_SAMPLES_PER_ARM} reported posts per arm at ${horizonHours}h; the thinnest arm has ${smallest}`,
    };
  }

  // Best-first, where "best" depends on the metric: skip rate wins by being
  // LOW. Sorting every metric descending silently crowned the worst arm.
  const scored = [...rates.entries()]
    .map(([armId, r]) => ({ armId, rate: r.rate ?? 0 }))
    .sort((a, b) => (spec.direction === "LOWER_IS_BETTER" ? a.rate - b.rate : b.rate - a.rate));

  // Cold start: every arm at zero is not a tie between equals, it is an
  // absence of signal. Ranking zeros produces a confident arbitrary winner.
  if (scored.every((s) => s.rate === 0)) {
    return {
      status: "no_signal",
      note: `every arm measured 0 on ${def.primaryMetric} — nothing to rank. Pick a metric this account actually registers, or run longer.`,
    };
  }

  const [top, second] = scored;
  // Lift is the MAGNITUDE of the improvement, measured in the metric's own
  // direction. Subtracting blind gives a negative lift whenever lower is
  // better (0.4 vs 0.9 skip rate reads as -55%), which then trips the tie
  // guard below and throws away a decisive result.
  const gap = spec.direction === "LOWER_IS_BETTER" ? second.rate - top.rate : top.rate - second.rate;
  const lift = second.rate === 0 ? Infinity : gap / second.rate;
  // A margin under 10% across this few posts is not a result.
  if (Number.isFinite(lift) && lift < 0.1) {
    return { status: "tie", note: `top two arms within ${(lift * 100).toFixed(1)}% — not separable at this sample size` };
  }

  const arm = def.arms.find((a) => a.armId === top.armId);
  return {
    status: "winner",
    armId: top.armId,
    variantValue: arm?.variantValue ?? top.armId,
    lift: Number.isFinite(lift) ? lift : 1,
    note: `${def.primaryVariable}=${arm?.variantValue} leads on ${def.primaryMetric} at ${horizonHours}h`,
  };
}

/**
 * Bucket a snapshot into its measurement horizon.
 *
 * `ig_metric_snapshots` is append-only and stamped with `capturedAt` — it does
 * NOT record which horizon a row belongs to, because a sync tick does not know
 * when the post went out. The horizon is therefore DERIVED from
 * (capturedAt - publishedAt), and this is the single place that derivation
 * lives so two callers cannot disagree about what "72h" means.
 *
 * Windows are generous on the late side and tight on the early side: a snapshot
 * taken at 20h is not a 24h reading (the post is still accruing fast), but one
 * taken at 30h is close enough to compare against other 24h rows. Anything
 * outside every window returns null and is EXCLUDED from comparison rather than
 * being forced into the nearest bucket, which would silently compare a 5-hour
 * reading against a 24-hour one.
 */
export function horizonForSnapshot(publishedAt: Date, capturedAt: Date): 24 | 72 | 168 | null {
  const hours = (capturedAt.getTime() - publishedAt.getTime()) / 3_600_000;
  if (hours < 20) return null;          // too early to be any horizon
  if (hours <= 36) return 24;
  if (hours < 60) return null;          // between windows — not comparable
  if (hours <= 96) return 72;
  if (hours < 144) return null;
  if (hours <= 216) return 168;
  return null;                          // past 9 days, no longer a 7-day reading
}

/** Deterministic arm assignment — same episode always lands in the same arm,
 *  so a re-run or a retry cannot silently reassign and corrupt the result. */
export function assignArm(def: ExperimentDefinition, episodeKey: string): ExperimentArm {
  let h = 0;
  for (let i = 0; i < episodeKey.length; i++) h = (h * 31 + episodeKey.charCodeAt(i)) >>> 0;
  return def.arms[h % def.arms.length];
}
