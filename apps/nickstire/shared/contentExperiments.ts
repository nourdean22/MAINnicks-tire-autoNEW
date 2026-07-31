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
  ];
  // The field the experiment is legitimately varying is exempt.
  const varying: Partial<Record<PrimaryVariable, keyof ExperimentArm>> = {
    cta_type: "ctaType",
    posting_slot: "postingSlot",
    franchise: "franchiseId",
    content_origin: "contentOrigin",
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

/** Per-arm rate on the primary metric, normalised by reach where reach exists.
 *  Rate beats raw totals: an arm that simply got more reach is not a better arm. */
export function armRates(
  def: ExperimentDefinition,
  observations: ArmObservation[],
  horizonHours: 24 | 72 | 168 = 72,
): Map<string, { n: number; rate: number | null; reported: number }> {
  const out = new Map<string, { n: number; rate: number | null; reported: number }>();
  for (const arm of def.arms) {
    const obs = observations.filter((o) => o.armId === arm.armId && o.horizonHours === horizonHours);
    const reported = obs.filter((o) => o.metricValue !== null);
    if (reported.length === 0) {
      out.set(arm.armId, { n: obs.length, rate: null, reported: 0 });
      continue;
    }
    let sum = 0;
    for (const o of reported) {
      const r = o.reach && o.reach > 0 ? (o.metricValue as number) / o.reach : (o.metricValue as number);
      sum += r;
    }
    out.set(arm.armId, { n: obs.length, rate: sum / reported.length, reported: reported.length });
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

  const scored = [...rates.entries()]
    .map(([armId, r]) => ({ armId, rate: r.rate ?? 0 }))
    .sort((a, b) => b.rate - a.rate);

  // Cold start: every arm at zero is not a tie between equals, it is an
  // absence of signal. Ranking zeros produces a confident arbitrary winner.
  if (scored.every((s) => s.rate === 0)) {
    return {
      status: "no_signal",
      note: `every arm measured 0 on ${def.primaryMetric} — nothing to rank. Pick a metric this account actually registers, or run longer.`,
    };
  }

  const [top, second] = scored;
  const lift = second.rate === 0 ? Infinity : (top.rate - second.rate) / second.rate;
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

/** Deterministic arm assignment — same episode always lands in the same arm,
 *  so a re-run or a retry cannot silently reassign and corrupt the result. */
export function assignArm(def: ExperimentDefinition, episodeKey: string): ExperimentArm {
  let h = 0;
  for (let i = 0; i < episodeKey.length; i++) h = (h * 31 + episodeKey.charCodeAt(i)) >>> 0;
  return def.arms[h % def.arms.length];
}
