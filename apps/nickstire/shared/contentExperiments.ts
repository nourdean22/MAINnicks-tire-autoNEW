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
import { mulberry32 } from "./experimentKernelCalibration";

export const EXPERIMENT_REGISTRY_VERSION = "content-experiments-v1" as const;

/** Below this many posts per arm, no verdict is issued. */
export const MIN_SAMPLES_PER_ARM = 4;

/**
 * A "winner" must also survive a permutation test at this level (2026-10-08).
 *
 * The rule before it was "top arm leads by 10% after 4 posts per arm". Instagram
 * per-post outcomes swing several-fold from post to post, so that rule crowned
 * a winner between two IDENTICAL arms in 85.8% of seeded simulated runs at 4
 * posts per arm (contentExperimentsValidity.test.ts keeps the old rule as its
 * control). The budget is spent across the planned DECISION_LOOKS below, and
 * the calibration walks the resolver's daily looks (4 … 100 posts per arm)
 * the way the cron does. Measured 2026-10-08, 400 runs per condition: identical
 * arms end as a false winner in 3.8% of experiments (69.5% tie, the rest still
 * running at 100 per arm); a doubled share rate is found in 99.8% (mean first
 * verdict at 27.5 posts per arm), a 1.5x rate in 85.0% (mean 61.4) — never on
 * the wrong arm. Otherwise the experiment keeps running (insufficient_data).
 */
const WINNER_ALPHA = 0.05;

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
  // 2026-08-06 · the snapshot COLUMN name, found live: the real running
  // experiment (hook-style-2026-08, seeded 08-01) declares primaryMetric
  // "avgWatchTimeMs" — absent here, so the evaluator refused it as unknown
  // and the experiment could never conclude. Same semantics as
  // avg_watch_time: milliseconds-per-viewer, weighted, higher wins.
  avgWatchTimeMs: { aggregation: "WEIGHTED_AVERAGE", direction: "HIGHER_IS_BETTER" },
  reels_skip_rate: { aggregation: "RAW_AVERAGE", direction: "LOWER_IS_BETTER" },
  // The snapshot column's own name, like avgWatchTimeMs above: an experiment
  // declared this way was gatherable (resolver) but had no spec here, so it
  // was refused `invalid_design` every day and could never resolve (2026-10-08).
  skipRate: { aggregation: "RAW_AVERAGE", direction: "LOWER_IS_BETTER" },
  shares: COUNT,
  saved: COUNT,
  likes: COUNT,
  reach: { aggregation: "RAW_TOTAL", direction: "HIGHER_IS_BETTER" },
  views: { aggregation: "RAW_TOTAL", direction: "HIGHER_IS_BETTER" },
};

/** An unregistered metric has no defensible aggregation — say so, don't guess. */
/** The ig_metric_snapshots column a metric name reads. */
export type SnapshotMetricColumn = "shares" | "saved" | "views" | "reach" | "avgWatchTimeMs" | "skipRate";

/**
 * Which snapshot column each gatherable metric name reads. Lives beside
 * METRIC_SPECS so one test can hold the invariant the resolver depends on:
 * every name here has a spec (else the evaluator refuses it as invalid_design
 * after the observations were gathered), and every preset's primary metric is
 * here (else the resolver reports it unmeasurable). A metric with no snapshot
 * column (dms, calls, comments…) is unmeasurable and is reported as such.
 */
export const SNAPSHOT_COLUMN_FOR_METRIC: Record<string, SnapshotMetricColumn> = {
  shares: "shares",
  shares_per_reach: "shares",
  saved: "saved",
  saves_per_reach: "saved",
  views: "views",
  reach: "reach",
  avg_watch_time: "avgWatchTimeMs",
  ig_reels_avg_watch_time: "avgWatchTimeMs",
  // The snapshot column name itself — the live hook-style-2026-08 experiment
  // declares its metric this way (found 2026-08-06 when the resolver reported
  // the estate's one real experiment "unmeasurable").
  avgWatchTimeMs: "avgWatchTimeMs",
  // Skip rate is the metric a hook experiment exists to move. It was missing
  // here AND unreadable in the gatherer (DECIMAL arrives as a string) until
  // 2026-10-08, so hook experiments could only be judged on proxies.
  skip_rate: "skipRate",
  reels_skip_rate: "skipRate",
  skipRate: "skipRate",
};

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
  | "content_origin"
  // Wave B presets (README §R). Each is a field on ExperimentArm so
  // findConfounds can check it — a variable you can name must be a field you
  // can check. Duration reuses `length_band`; opening asset reuses
  // `content_origin`.
  | "cover_origin"
  | "audio_style"
  | "fb_format";

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
  coverOrigin?: string;
  audioStyle?: string;
  fbFormat?: string;
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
    "coverOrigin", "audioStyle", "fbFormat",
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
    cover_origin: "coverOrigin",
    audio_style: "audioStyle",
    fb_format: "fbFormat",
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

/** One post's value on the primary metric, on the same footing armRates uses. */
function perPostValue(spec: MetricSpec, o: ArmObservation): number {
  const v = o.metricValue as number;
  return spec.aggregation === "COUNT_PER_REACH" && o.reach && o.reach > 0 ? v / o.reach : v;
}

/** The weight armRates gives one post: its reach for a WEIGHTED_AVERAGE metric, 1 for every other aggregation. */
function perPostWeight(spec: MetricSpec, o: ArmObservation): number {
  return spec.aggregation === "WEIGHTED_AVERAGE" && o.reach && o.reach > 0 ? o.reach : 1;
}

/**
 * Thinnest-arm reported counts at which a verdict may CONCLUDE (2026-10-08).
 *
 * The resolver re-evaluates every day, and a rule validated at ONE look was
 * being applied at every look: under the validity test's own noise model an
 * A/A experiment concluded in 83% of runs (optional stopping — each day's
 * glance at p ≤ 0.05 is another chance for noise to cross it; and the "under
 * 10% lead → tie" rule concluded before any test at all). So verdicts are
 * allowed only at these planned looks, with WINNER_ALPHA split across them
 * (Bonferroni; conservative, stateless, no bookkeeping of looks taken), and a
 * tie — "no actionable difference" — only from the 48-per-arm look on. Past
 * the last look, every further 48 posts per arm is another look. Between
 * looks the verdict is insufficient_data naming the next look.
 */
export const DECISION_LOOKS = [12, 24, 48, 96] as const;
const TIE_FROM_LOOK = 48;
const LOOK_STEP_AFTER_LAST = 48;

export function isDecisionLook(thinnestArm: number): boolean {
  if ((DECISION_LOOKS as readonly number[]).includes(thinnestArm)) return true;
  const last = DECISION_LOOKS[DECISION_LOOKS.length - 1];
  return thinnestArm > last && (thinnestArm - last) % LOOK_STEP_AFTER_LAST === 0;
}

export function nextDecisionLook(thinnestArm: number): number {
  for (const look of DECISION_LOOKS) if (look > thinnestArm) return look;
  const last = DECISION_LOOKS[DECISION_LOOKS.length - 1];
  return last + (Math.floor((thinnestArm - last) / LOOK_STEP_AFTER_LAST) + 1) * LOOK_STEP_AFTER_LAST;
}

/**
 * Two-sided permutation p-value for a difference in (weighted) means between
 * two arms' per-post values: the share of relabellings of the pooled posts
 * whose mean gap is at least the observed one. Exact when the relabellings
 * are few enough to enumerate, otherwise a fixed-seed Monte Carlo of 20,000
 * draws, so the same data always returns the same p. Valid with no assumption
 * about the shape of the per-post distribution, which is the point: reach is
 * heavy-tailed.
 *
 * WEIGHTS (2026-10-08). The statistic is the gap between the arms' weighted
 * means, Σ(v·w)/Σw, with the weights the caller ranks by — reach for a
 * WEIGHTED_AVERAGE metric, 1 otherwise. Testing the UNWEIGHTED gap while
 * ranking by the weighted one could crown the arm the test had just shown to
 * be worse (one 9,000 ms post at 50,000 reach beside five at 10 reach beat
 * six honest 5,000 ms posts, p = 0.015, in the direction the test did not
 * support). With every weight 1 this is exactly the old unweighted test.
 */
export function permutationP(a: number[], b: number[], weightsA?: number[], weightsB?: number[]): number {
  const n = a.length + b.length;
  const k = a.length;
  if (k === 0 || k === n) return 1;
  const w = [...(weightsA ?? a.map(() => 1)), ...(weightsB ?? b.map(() => 1))].map((x) => (x > 0 && Number.isFinite(x) ? x : 1));
  const vw = [...a, ...b].map((v, i) => v * w[i]);
  const totalVW = vw.reduce((s, x) => s + x, 0);
  const totalW = w.reduce((s, x) => s + x, 0);
  // Gap between the weighted means of a k-subset and its complement.
  const gap = (sumVW: number, sumW: number) => {
    const restW = totalW - sumW;
    if (sumW <= 0 || restW <= 0) return 0;
    return Math.abs(sumVW / sumW - (totalVW - sumVW) / restW);
  };
  let obsVW = 0;
  let obsW = 0;
  for (let i = 0; i < k; i++) { obsVW += vw[i]; obsW += w[i]; }
  const observed = gap(obsVW, obsW) - 1e-12;

  let combos = 1;
  for (let i = 0; i < k; i++) combos = (combos * (n - i)) / (i + 1);
  let hits = 0;
  let draws = 0;
  if (combos <= 50_000) {
    const idx = Array.from({ length: k }, (_, i) => i);
    for (;;) {
      let sVW = 0;
      let sW = 0;
      for (const i of idx) { sVW += vw[i]; sW += w[i]; }
      draws++;
      if (gap(sVW, sW) >= observed) hits++;
      let j = k - 1;
      while (j >= 0 && idx[j] === n - k + j) j--;
      if (j < 0) break;
      idx[j]++;
      for (let m = j + 1; m < k; m++) idx[m] = idx[m - 1] + 1;
    }
  } else {
    let seed = n * 7919 + k;
    for (let i = 0; i < n; i++) seed = (seed * 31 + Math.round(vw[i] * 1e6) + Math.round(w[i])) >>> 0;
    const rng = mulberry32(seed);
    const order = Array.from({ length: n }, (_, i) => i);
    for (draws = 0; draws < 20_000; draws++) {
      for (let i = 0; i < k; i++) {
        const j = i + Math.floor(rng() * (n - i));
        [order[i], order[j]] = [order[j], order[i]];
      }
      let sVW = 0;
      let sW = 0;
      for (let i = 0; i < k; i++) { sVW += vw[order[i]]; sW += w[order[i]]; }
      if (gap(sVW, sW) >= observed) hits++;
    }
  }
  return hits / draws;
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

  // Verdicts only at a planned look (see DECISION_LOOKS). Every other day the
  // honest answer is "not yet", naming the next look.
  if (!isDecisionLook(smallest)) {
    const next = nextDecisionLook(smallest);
    return {
      status: "insufficient_data",
      needed: next,
      have: smallest,
      note: `between decision looks: the thinnest arm has ${smallest} reported posts, next verdict at ${next} per arm` +
        (Number.isFinite(lift) ? ` (top arm currently leads by ${(lift * 100).toFixed(1)}%)` : ""),
    };
  }
  const alphaPerLook = WINNER_ALPHA / DECISION_LOOKS.length;

  // A margin under 10% is not a result worth acting on. From the 48-per-arm
  // look it is a tie ("retire this variable" is the proposal); before that it
  // is not yet a finding — a 9% lead at 12 posts says nothing about 48.
  if (Number.isFinite(lift) && lift < 0.1) {
    if (smallest >= TIE_FROM_LOOK) {
      return { status: "tie", note: `top two arms within ${(lift * 100).toFixed(1)}% after ${smallest} posts per arm — no actionable difference` };
    }
    const next = nextDecisionLook(smallest);
    return {
      status: "insufficient_data",
      needed: next,
      have: smallest,
      note: `top two arms within ${(lift * 100).toFixed(1)}% at ${smallest} per arm — too close to call before the ${TIE_FROM_LOOK}-per-arm look; next look at ${next}`,
    };
  }

  // The lead must also be distinguishable from noise. The two leaders were
  // picked AFTER looking at the data, so with more than two arms the p-value
  // is multiplied by the number of possible runners-up (Bonferroni) to pay for
  // that choice; the per-look alpha pays for the planned looks.
  const posts = (armId: string) =>
    observations.filter((o) => o.armId === armId && o.horizonHours === horizonHours && o.metricValue !== null);
  const topPosts = posts(top.armId);
  const secondPosts = posts(second.armId);
  const p = Math.min(1, permutationP(
    topPosts.map((o) => perPostValue(spec, o)),
    secondPosts.map((o) => perPostValue(spec, o)),
    topPosts.map((o) => perPostWeight(spec, o)),
    secondPosts.map((o) => perPostWeight(spec, o)),
  ) * (scored.length - 1));
  // A lead that noise could explain is NOT a tie. The resolver CONCLUDES an
  // experiment on a tie and proposes retiring the variable, so reporting
  // "not enough evidence yet" as a tie would end a live experiment and kill a
  // possibly-real effect. It is insufficient data: the experiment keeps
  // running and the next round of posts is the "needed".
  if (p > alphaPerLook) {
    const next = nextDecisionLook(smallest);
    return {
      status: "insufficient_data",
      needed: next,
      have: smallest,
      note: `top arm leads by ${Number.isFinite(lift) ? `${(lift * 100).toFixed(1)}%` : "an undefined margin"} but a permutation test cannot yet tell it from noise (p=${p.toFixed(3)} > ${alphaPerLook.toFixed(4)} per look); next look at ${next} per arm`,
    };
  }

  const arm = def.arms.find((a) => a.armId === top.armId);
  return {
    status: "winner",
    armId: top.armId,
    variantValue: arm?.variantValue ?? top.armId,
    lift: Number.isFinite(lift) ? lift : 1,
    note: `${def.primaryVariable}=${arm?.variantValue} leads on ${def.primaryMetric} at ${horizonHours}h (permutation p=${p.toFixed(3)})`,
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

// ─────────────────────────────────────────────────────────────────────────
// PRESETS (README §R, Wave B). One place for every operator-startable
// experiment, so routers/content.ts cannot drift from what the pipeline reads.
//
// hook_style_v1 keeps its ORIGINAL experimentId and arms byte-for-byte:
// startExperiment is ON DUPLICATE KEY UPDATE on experiment_id, so a changed id
// would start a second experiment beside the live one instead of re-asserting it.
//
// hook_style_v1 and duration_v1 are WIRED (dailyReelPost reads the hook arm;
// reelBriefGen reads the lane and sets the brief's target). The others are
// EXPOSED: defined, so the design is reviewed and kept, but nothing in
// generation reads their arm. Since 2026-10-08 an exposed preset cannot be
// STARTED (routers/content.ts), is not judged if one is already running
// (contentExperimentResolve) and receives no assignments: both arms would get
// identical content, so the "experiment" is an A/A test under a treatment's
// name, and the resolver would conclude a false tie ("retire this variable")
// or, 5% of the time, a false winner.
// ─────────────────────────────────────────────────────────────────────────

export const EXPERIMENT_PRESET_IDS = [
  "hook_style_v1",
  "duration_v1",
  "opening_asset_v1",
  "carousel_cover_v1",
  "audio_v1",
  "fb_format_v1",
] as const;
export type ExperimentPresetId = typeof EXPERIMENT_PRESET_IDS[number];

/**
 * Duration lanes for duration_v1. The arm's variantValue IS the lane id, and
 * the lane's seconds are what reelBriefGen targets. Declared here, not in the
 * generator, so the resolver and the generator read one table.
 */
export const DURATION_LANES = {
  "18-24s": { minSeconds: 18, maxSeconds: 24 },
  "30-40s": { minSeconds: 30, maxSeconds: 40 },
  "45-60s": { minSeconds: 45, maxSeconds: 60 },
} as const;
export type DurationLaneId = keyof typeof DURATION_LANES;

export function isDurationLaneId(v: unknown): v is DurationLaneId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(DURATION_LANES, v);
}

export interface ExperimentPreset extends ExperimentDefinition {
  preset: ExperimentPresetId;
  hypothesis: string;
  /** What the primary metric stands in for, when the §R metric is not yet gatherable. */
  metricNote: string;
  /** WIRED: the arm changes generation. EXPOSED: recorded + resolvable, not yet read by any generator. */
  wiring: "wired" | "exposed";
}

export function buildExperimentPreset(preset: ExperimentPresetId, startedAt: string = new Date().toISOString()): ExperimentPreset {
  switch (preset) {
    case "hook_style_v1":
      return {
        preset,
        experimentId: "hook-style-direct-v1",
        primaryVariable: "hook_style",
        objective: "discovery",
        primaryMetric: "shares_per_reach",
        arms: [
          { armId: "hook-control", variantValue: "baseline", hookStyle: "baseline" },
          { armId: "hook-direct", variantValue: "direct", hookStyle: "direct" },
        ],
        startedAt,
        hypothesis: "A direct opener (no warm-up) beats the baseline on sends/reach.",
        metricNote: "shares_per_reach resolves to the `shares` snapshot column.",
        wiring: "wired",
      };
    case "duration_v1":
      return {
        preset,
        experimentId: "duration-lane-v1",
        primaryVariable: "length_band",
        objective: "discovery",
        primaryMetric: "shares_per_reach",
        arms: [
          { armId: "duration-18-24", variantValue: "18-24s", lengthBand: "18-24s" },
          { armId: "duration-30-40", variantValue: "30-40s", lengthBand: "30-40s" },
          { armId: "duration-45-60", variantValue: "45-60s", lengthBand: "45-60s" },
        ],
        startedAt,
        hypothesis: "30-40 s explainers hold the 20 s 3-s survival with higher sends; then 45-60 s.",
        // §R names 3-s skip, watch/duration and sends/reach. This preset was
        // defined when only sends/reach was decidable, and a running
        // experiment must keep the metric it started on (switching after the
        // data arrives is choosing the metric that wins). Skip rate became
        // gatherable on 2026-10-08, so a duration_v2 can decide on it;
        // watch/duration still needs the reel's own length, which no snapshot
        // stores.
        metricNote: "sends/reach (shares_per_reach), kept for the experiment already defined on it. 3-s skip is gatherable since 2026-10-08 (use it in a v2); watch/duration is not. " +
          "Under REEL_OUTPUT_RULES (35 s storyboard ceiling, 6 beats x 4 s = 24 s render cap) the 30-40 s and 45-60 s arms both clamp to a 30-35 s declared target — raise the ceiling and the clip cap before reading those two arms apart.",
        wiring: "wired",
      };
    case "opening_asset_v1":
      return {
        preset,
        experimentId: "opening-asset-v1",
        primaryVariable: "content_origin",
        objective: "discovery",
        // 3-s survival IS the hypothesis, and skip rate is gatherable since
        // 2026-10-08. Never started (exposed presets cannot be), so moving it
        // off the sends/reach stand-in changes no running experiment.
        primaryMetric: "skip_rate",
        arms: [
          { armId: "open-ai", variantValue: "ai_generated", contentOrigin: "ai_generated" },
          { armId: "open-real", variantValue: "real_shop", contentOrigin: "real_shop" },
        ],
        startedAt,
        hypothesis: "A real-shop opening frame beats an AI opening frame on 3-s survival.",
        metricNote: "skip_rate (lower wins) is the 3-s survival reading. Non-follower reach is not stored.",
        wiring: "exposed",
      };
    case "carousel_cover_v1":
      return {
        preset,
        experimentId: "carousel-cover-v1",
        primaryVariable: "cover_origin",
        objective: "utility",
        primaryMetric: "saves_per_reach",
        arms: [
          { armId: "cover-deterministic", variantValue: "deterministic", coverOrigin: "deterministic" },
          { armId: "cover-real", variantValue: "real", coverOrigin: "real" },
        ],
        startedAt,
        hypothesis: "A carousel with a real cover photo earns more saves/reach than the deterministic cover.",
        metricNote: "saves_per_reach resolves to the `saved` snapshot column.",
        wiring: "exposed",
      };
    case "audio_v1":
      return {
        preset,
        experimentId: "audio-style-v1",
        primaryVariable: "audio_style",
        objective: "discovery",
        primaryMetric: "avg_watch_time",
        arms: [
          { armId: "audio-vo-bed", variantValue: "vo_bed", audioStyle: "vo_bed" },
          { armId: "audio-vo-foley", variantValue: "vo_foley", audioStyle: "vo_foley" },
        ],
        startedAt,
        hypothesis: "Foley + VO beats music-bed + VO on completion.",
        metricNote: "avg_watch_time (reach-weighted) stands in for completion; replays are not stored.",
        wiring: "exposed",
      };
    case "fb_format_v1":
      return {
        preset,
        experimentId: "fb-format-v1",
        primaryVariable: "fb_format",
        objective: "community",
        primaryMetric: "reach",
        arms: [
          { armId: "fb-image", variantValue: "image_crosspost", fbFormat: "image_crosspost" },
          { armId: "fb-album", variantValue: "album", fbFormat: "album" },
        ],
        startedAt,
        hypothesis: "An FB album (4-6 photos) beats a cross-posted image on local reach and comments.",
        metricNote: "reach (raw total). Comments are not a gatherable snapshot metric for the resolver.",
        wiring: "exposed",
      };
  }
}

let unwiredIds: Set<string> | null = null;

/**
 * True when this experiment id belongs to an EXPOSED preset: no generator
 * applies its arm, so measuring it measures nothing (see PRESETS above). Ids
 * that are not presets are not this function's business and read false.
 */
export function isUnwiredExperimentId(experimentId: string): boolean {
  unwiredIds ??= new Set(
    EXPERIMENT_PRESET_IDS.map((id) => buildExperimentPreset(id, "")).filter((d) => d.wiring !== "wired").map((d) => d.experimentId),
  );
  return unwiredIds.has(experimentId);
}
