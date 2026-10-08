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
 * PURE: no clock, no DB, no React. The server sends raw reads; the client calls
 * `buildLaneHealthRows` with its own `now`, like ../client/.../freshnessRows.ts.
 */

import {
  HOLDOUT_MIN_MATURED_PER_ARM,
  buildHoldoutLift,
  type HoldoutLift,
  type HoldoutObservationInput,
} from "./loopScoreboard";
import { provenanceOf, type TileProvenance } from "./tileProvenance";

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

/** Days of cron_log the server keeps (cron/jobs/cleanup.ts). */
const CRON_LOG_RETENTION_DAYS = 7;
/** A lane whose last completed run is older than this reads stale. */
const LANE_STALE_AFTER_HOURS = 72;

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

// ─── The row the card draws ───────────────────────────────────────────────

export type LaneState = "running" | "blocked" | "failing" | "stale" | "unknown";

export interface LaneCell {
  text: string;
  provenance: TileProvenance;
}

export interface LaneHealthRow {
  key: string;
  label: string;
  state: LaneState;
  lastRun: LaneCell;
  sent: LaneCell;
  outcome: LaneCell;
  /** Why the lane is not reaching customers, or null when nothing says so. */
  blockedReason: string | null;
  /** What the last completed run said about itself (cron_log.details, masked). */
  lastNote: string | null;
}

const MEASURED = provenanceOf("observed");
const UNMEASURED = provenanceOf("observed", "unavailable");
/** A holdout lift is inferred from a randomized sample: a measurement, but modeled. */
const INFERRED = provenanceOf("inferred");

function ageText(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

function toDate(v: Date | string): Date | null {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * cron_log.details for a failed run is err.message. A drizzle error message
 * carries the SQL and its bound params, and a phone number or email is often
 * one of them, so phone-shaped digit runs (bare or formatted) and emails are
 * masked and the text is cut to one short line.
 */
const PHONE_LIKE = /\+?\(?\d[\d\s().-]{5,}\d/g;
const EMAIL_LIKE = /[^\s@<>()"']+@[^\s@<>()"']+\.[A-Za-z]{2,}/g;

function maskRunDetail(details: string | null | undefined, max = 90): string | null {
  if (!details) return null;
  const firstLine = details
    .split("\n")[0]!
    .replace(EMAIL_LIKE, "•••")
    // A formatted run needs a phone's 10 digits (so a date survives); a bare
    // run of 7+ digits is masked whatever it is.
    .replace(PHONE_LIKE, (m) => {
      const digits = m.replace(/\D/g, "").length;
      return digits >= 10 || (/^\d+$/.test(m) && digits >= 7) ? "•••" : m;
    })
    .trim();
  if (!firstLine) return null;
  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}

/** The scheduler's skip reasons (cron/scheduler.ts runTier), in plain words. */
function skipReason(details: string | null | undefined): string {
  const d = details ?? "";
  const flag = /^requiresFlag:([A-Za-z0-9_]+) \((.*)\)$/s.exec(d);
  if (flag) return `flag ${flag[1]} off (${flag[2]})`;
  const env = /^requiresEnv:([A-Za-z0-9_|]+)/.exec(d);
  if (env) return `env ${env[1]!.split("|").join(" or ")} not set`;
  const dep = /^requiresSuccessfulJobs:([A-Za-z0-9_|-]+)/.exec(d);
  if (dep) return `waiting on ${dep[1]!.split("|").join(", ")} (did not succeed that pass)`;
  return `skipped: ${maskRunDetail(d) ?? "no reason logged"}`;
}

function isLockSkip(run: LaneRunRow): boolean {
  return run.status === "skipped" && /^cross-dyno lock/.test(run.details ?? "");
}

interface RunVerdict {
  cell: LaneCell;
  state: LaneState;
  reason: string | null;
  note?: string | null;
}

/**
 * A run that COMPLETED but says it did nothing on purpose. These are the jobs'
 * own words (declinedWorkRecovery "DRY RUN: N eligible ...", its "nothing was
 * sent" when the match failed, reviewReminder "flag ... off", winback "tables
 * not set up"), matched literally; anything else is shown as a note only.
 */
const COMPLETED_BUT_IDLE = [/\bDRY RUN\b/, /nothing was sent/i, /\bflag \S+ off\b/i, /not set up/i, /^No DB$/];

function classifyRun(
  readable: boolean,
  runs: { latest: LaneRunRow | null; latestCompleted: LaneRunRow | null } | undefined,
  now: Date,
): RunVerdict {
  if (!readable) {
    return {
      cell: { text: "unknown", provenance: UNMEASURED },
      state: "unknown",
      reason: "the run log could not be read",
    };
  }
  // Another pod held the lock: that pass ran elsewhere. Judge the lane by its
  // last completed run instead of calling it blocked.
  const latest = runs?.latest && isLockSkip(runs.latest) ? (runs.latestCompleted ?? runs.latest) : (runs?.latest ?? null);
  if (!latest) {
    return {
      cell: { text: `no run in ${CRON_LOG_RETENTION_DAYS}d`, provenance: MEASURED },
      state: "stale",
      reason: `no run logged in the last ${CRON_LOG_RETENTION_DAYS} days`,
    };
  }
  const at = toDate(latest.startedAt);
  const ageMs =
    typeof latest.ageMinutes === "number" && Number.isFinite(latest.ageMinutes)
      ? latest.ageMinutes * 60_000
      : at
        ? now.getTime() - at.getTime()
        : null;
  if (ageMs == null) {
    return {
      cell: { text: "unknown", provenance: UNMEASURED },
      state: "unknown",
      reason: "the last run has no valid time",
    };
  }
  const age = `${ageText(ageMs)} ago`;

  if (latest.status === "failed") {
    const why = maskRunDetail(latest.details);
    return {
      cell: { text: `${age} · failed`, provenance: MEASURED },
      state: "failing",
      reason: why ? `last run failed: ${why}` : "last run failed",
    };
  }
  if (latest.status === "skipped") {
    return {
      cell: { text: `${age} · skipped`, provenance: MEASURED },
      state: "blocked",
      reason: skipReason(latest.details),
    };
  }
  const processed = latest.recordsProcessed ?? 0;
  const note = maskRunDetail(latest.details, 140);
  const ageHours = ageMs / 3_600_000;
  if (ageHours > LANE_STALE_AFTER_HOURS) {
    return {
      cell: { text: `${age} · processed ${processed}`, provenance: MEASURED },
      state: "stale",
      reason: `no run since ${age}`,
      note,
    };
  }
  // Match on the whole first line: declined recovery prefixes its "DRY RUN"
  // with a match note, which could push it past the display cut.
  const fullLine = maskRunDetail(latest.details, Number.MAX_SAFE_INTEGER);
  if (fullLine && COMPLETED_BUT_IDLE.some((re) => re.test(fullLine))) {
    // Show the clause that says it, not the prefix before it.
    const clause = fullLine.split(" · ").find((seg) => COMPLETED_BUT_IDLE.some((re) => re.test(seg))) ?? fullLine;
    return {
      cell: { text: `${age} · processed ${processed}`, provenance: MEASURED },
      state: "blocked",
      reason: maskRunDetail(clause, 140),
      note: null,
    };
  }
  return { cell: { text: `${age} · processed ${processed}`, provenance: MEASURED }, state: "running", reason: null, note };
}

function classifySent(
  spec: CustomerLaneSpec,
  sms: LaneHealthPayload["sms"],
  windowDays: number,
): { cell: LaneCell; reason: string | null } {
  if (!sms.readable) {
    return { cell: { text: "unknown", provenance: UNMEASURED }, reason: null };
  }
  let attempted = 0;
  let sent = 0;
  for (const r of sms.byVariant) {
    if (!spec.variant.test(r.variantKey)) continue;
    attempted += r.attempted;
    sent += r.sent;
  }
  const undelivered = attempted - sent;
  const text =
    undelivered > 0 ? `${sent} in ${windowDays}d · ${undelivered} not delivered` : `${sent} in ${windowDays}d`;
  const reason =
    attempted > 0 && sent === 0 ? `0 of ${attempted} texts delivered in ${windowDays}d` : null;
  return { cell: { text, provenance: MEASURED }, reason };
}

/** Sum the lane's experiments (retention has one per tier; weather one per trigger). */
function poolHoldout(
  spec: CustomerLaneSpec,
  byLane: LaneHealthPayload["holdout"]["byLane"],
): HoldoutObservationInput | null {
  if (!spec.holdoutLane) return null;
  const parts = byLane.filter((o) => spec.holdoutLane!.test(o.laneKey));
  if (parts.length === 0) return null;
  return parts.reduce<HoldoutObservationInput>(
    (acc, o) => ({
      experimentId: parts.length === 1 ? o.experimentId : `${spec.key}:pooled`,
      treatmentAssigned: acc.treatmentAssigned + o.treatmentAssigned,
      controlAssigned: acc.controlAssigned + o.controlAssigned,
      treatmentMatured: acc.treatmentMatured + o.treatmentMatured,
      controlMatured: acc.controlMatured + o.controlMatured,
      treatmentPaidInvoices: acc.treatmentPaidInvoices + o.treatmentPaidInvoices,
      controlPaidInvoices: acc.controlPaidInvoices + o.controlPaidInvoices,
      treatmentRevenueCents: acc.treatmentRevenueCents + o.treatmentRevenueCents,
      controlRevenueCents: acc.controlRevenueCents + o.controlRevenueCents,
    }),
    {
      experimentId: "",
      treatmentAssigned: 0,
      controlAssigned: 0,
      treatmentMatured: 0,
      controlMatured: 0,
      treatmentPaidInvoices: 0,
      controlPaidInvoices: 0,
      treatmentRevenueCents: 0,
      controlRevenueCents: 0,
    },
  );
}

function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "+";
  return `${sign}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
}

function classifyOutcome(spec: CustomerLaneSpec, payload: LaneHealthPayload): LaneCell {
  if (!spec.holdoutLane) {
    return { text: spec.noHoldoutReason ?? "no holdout", provenance: UNMEASURED };
  }
  if (payload.holdout.state === "error") {
    return { text: "unknown · the holdout read failed", provenance: UNMEASURED };
  }
  if (payload.holdout.state === "pending") {
    return { text: "no holdout yet (migration 0136 not applied)", provenance: UNMEASURED };
  }
  const lift: HoldoutLift = buildHoldoutLift(poolHoldout(spec, payload.holdout.byLane));
  if (lift.status === "OBSERVED_HOLDOUT" && lift.incrementalGrossRevenueCents != null) {
    return {
      text: `${dollars(lift.incrementalGrossRevenueCents)} gross vs holdout (${lift.treatmentMatured} vs ${lift.controlMatured} matured)`,
      provenance: INFERRED,
    };
  }
  if (lift.status === "COLLECTING") {
    return {
      text: `collecting · ${Math.min(lift.treatmentMatured, lift.controlMatured)} matured per arm, ${HOLDOUT_MIN_MATURED_PER_ARM} needed`,
      provenance: UNMEASURED,
    };
  }
  const armed = payload.holdoutArmed[spec.key];
  if (armed === false) return { text: "holdout not armed", provenance: UNMEASURED };
  if (armed === true) return { text: "holdout armed · no one assigned yet", provenance: UNMEASURED };
  return { text: "no holdout data · flags unread", provenance: UNMEASURED };
}

function buildLaneHealthRow(spec: CustomerLaneSpec, payload: LaneHealthPayload, now: Date): LaneHealthRow {
  const run = classifyRun(payload.cron.readable, payload.cron.runs[spec.jobName], now);
  const sent = classifySent(spec, payload.sms, payload.windowDays);
  // A lane that runs on time but delivers nothing is blocked downstream of the
  // scheduler (gateway, opt-outs, carrier): the run cell alone would read fine.
  const state: LaneState = run.state === "running" && sent.reason ? "blocked" : run.state;
  return {
    key: spec.key,
    label: spec.label,
    state,
    lastRun: run.cell,
    sent: spec.draftsOnly ? { ...sent.cell, text: `${sent.cell.text} (approved drafts)` } : sent.cell,
    outcome: classifyOutcome(spec, payload),
    blockedReason: run.reason ?? sent.reason,
    lastNote: run.note ?? null,
  };
}

export function buildLaneHealthRows(payload: LaneHealthPayload, now: Date): LaneHealthRow[] {
  return CUSTOMER_LANES.map((spec) => buildLaneHealthRow(spec, payload, now));
}
