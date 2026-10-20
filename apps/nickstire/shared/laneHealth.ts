/**
 * laneHealth — Q-23 phase 11 · the lane-health strip on Intelligence HQ.
 *
 * Estate plan §9 item 2: per customer lane, last run, eligible, sent,
 * holdout-adjusted outcome and blocked reason. Every customer-contact lane runs
 * from a cron job, texts under its own `sms_messages.variantKey`, and (for the
 * Q-21 lanes) has a randomized no-contact holdout in
 * `contact_experiment_assignments`. Before this, those three facts lived on
 * three different screens and nothing said "this lane has not run for four
 * days because its flag is off".
 *
 * "Eligible" is NOT drawn. No lane records how many customers it considered;
 * `cron_log.records_processed` is whatever each job chooses to count (sends for
 * most, matches for some). The strip shows it as "processed N", which is what it
 * is, rather than relabelling it as eligibility.
 *
 * The rule every cell keeps (the repo's empty-vs-error rule): a failed read is
 * "unknown" and UNMEASURED, never 0 and never "not run". `cron_log` is pruned
 * after 7 days (cron/jobs/cleanup.ts), so "no run" means "no run in 7 days".
 *
 * 2026-10-19 (admin prune W1): the client row builder (buildLaneHealthRows) and the
 * card it fed (Today's LaneHealthStrip) were cut; the lane registry and the server
 * payload shape stay, read by server/routers/smsPerformance.ts.
 */

import type { HoldoutObservationInput } from "./loopScoreboard";

export interface CustomerLaneSpec {
  key: string;
  label: string;
  /** cron_log.job_name of the scheduler job that drives the lane. */
  jobName: string;
  /** Which sms_messages.variantKey values belong to the lane. */
  variant: RegExp;
  /**
   * Which contact_experiment_assignments.lane_key values belong to the lane,
   * or null when the lane has no Q-21 holdout (see noHoldoutReason).
   */
  holdoutLane: RegExp | null;
  /**
   * A variantKey the server hands to contactLaneForVariant() to find the
   * lane's holdout flag. Null when holdoutLane is null.
   */
  holdoutProbeVariant: string | null;
  /** Why the outcome cell is unmeasured for a lane with no holdout. */
  noHoldoutReason?: string;
  /** The lane writes drafts for human review; "sent" counts approved texts only. */
  draftsOnly?: boolean;
}

/**
 * The customer lanes that are live in the scheduler today. Job names are pinned
 * against server/cron/scheduler.ts and variant keys against the senders by
 * laneHealthRegistry.test.ts, so a renamed job fails a test instead of showing
 * "no run in 7 days" forever. cross-sell-outreach is not here: it was retired
 * 2026-08-04 (scheduler.ts, ROS-033).
 */
export const CUSTOMER_LANES: readonly CustomerLaneSpec[] = Object.freeze([
  {
    key: "declined_recovery",
    label: "Declined-work recovery",
    jobName: "alg-declined-work-recovery",
    variant: /^declined_/,
    holdoutLane: null,
    holdoutProbeVariant: null,
    noHoldoutReason: "own holdout design, see Recovered revenue",
  },
  {
    key: "retention",
    label: "Retention D7-D365",
    jobName: "retention-all",
    variant: /^retention_d\d+(?:_v\d+)?$/,
    holdoutLane: /^retention_d\d+$/,
    holdoutProbeVariant: "retention_d7",
  },
  {
    key: "winback",
    label: "Win-back",
    jobName: "winback-auto-process",
    variant: /^winback$/,
    holdoutLane: /^winback$/,
    holdoutProbeVariant: "winback",
  },
  {
    key: "review_request",
    label: "Review requests",
    jobName: "review-requests",
    variant: /^review_request$/,
    holdoutLane: /^review_request$/,
    holdoutProbeVariant: "review_request",
  },
  {
    key: "review_reminder",
    label: "Review reminder (drafts)",
    jobName: "review-reminder-drafts",
    variant: /^review_reminder$/,
    holdoutLane: /^review_reminder$/,
    holdoutProbeVariant: "review_reminder",
    draftsOnly: true,
  },
  {
    key: "weather",
    label: "Weather triggers",
    jobName: "weather-intel",
    variant: /^weather_[a-z0-9_-]+$/i,
    holdoutLane: /^weather_[a-z0-9_-]+$/i,
    holdoutProbeVariant: "weather_freeze",
  },
  {
    key: "drip",
    label: "Drip campaigns",
    jobName: "drip-step-processor",
    variant: /^drip$/,
    holdoutLane: null,
    holdoutProbeVariant: null,
    noHoldoutReason: "no holdout: one key pools every drip campaign",
  },
  {
    key: "campaign_retry",
    label: "Review + referral auto-retry",
    jobName: "campaign-auto-retry",
    variant: /^campaign_retry$/,
    holdoutLane: null,
    holdoutProbeVariant: null,
    noHoldoutReason: "no holdout registered",
  },
]);

// ─── The server payload ───────────────────────────────────────────────────

export interface LaneRunRow {
  status: string;
  startedAt: Date | string;
  recordsProcessed: number | null;
  details: string | null;
  /**
   * Minutes between the run's start and the read, computed in SQL. Preferred
   * over startedAt: driver-parsed TiDB times come back shifted on ET.
   */
  ageMinutes?: number | null;
}

export interface LaneHealthPayload {
  /** Window of the sent counts. */
  windowDays: number;
  cron: {
    readable: boolean;
    /** Keyed by job name. A job with no row in cron_log is absent. */
    runs: Record<string, { latest: LaneRunRow | null; latestCompleted: LaneRunRow | null }>;
  };
  sms: {
    readable: boolean;
    byVariant: Array<{ variantKey: string; attempted: number; sent: number }>;
  };
  holdout: {
    /** read: the table was read · pending: migration 0136 not applied · error: read failed. */
    state: "read" | "pending" | "error";
    byLane: Array<HoldoutObservationInput & { laneKey: string }>;
  };
  /**
   * Keyed by lane spec key: true when both contact_holdouts_enabled and the
   * lane's flag are on, null when the flags could not be read. Absent for
   * lanes with no holdout.
   */
  holdoutArmed: Record<string, boolean | null>;
}
