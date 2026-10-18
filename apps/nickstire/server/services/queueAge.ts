/**
 * QUEUE-AGE CONTRACTS — assert that a queue DRAINS, not that its job ran.
 *
 * cron_log records `completed` whenever a handler returns, so a loop can run on
 * schedule for weeks while the oldest row it exists to process sits untouched.
 * loopShapeContract.ts asks "did the run produce anything?"; this asks the
 * other half: "is the oldest due-but-unprocessed row older than this loop's
 * cadence can explain?" (research item C5.2; the outbound-sms-queue contract's
 * "rows stuck in `sending`" note, ROS-020, is the same shape).
 *
 * Same doctrine as loopShapeContract: pure, no DB handle, no clock, no alerting.
 * The readers (queueAgeReaders.ts) measure; the cron observer reports.
 *
 * VERDICTS
 *   in-spec  oldest due row is within maxAgeMinutes (equal counts as in-spec)
 *   stuck    oldest due row is older than maxAgeMinutes
 *   empty    a SUCCESSFUL read found no due row
 *   skipped  the loop is deliberately off (flag / dry run): nothing drains by design
 *   unknown  the read failed. Never in-spec, never empty: a failed read is not zero.
 */

export type QueueAgeVerdict = "in-spec" | "stuck" | "empty" | "skipped" | "unknown";

export interface QueueAgeDeclaration {
  /** Scheduler job name; a second check on the same job uses `<job>:<check>`. */
  loop: string;
  /** What a due row is, in the operator's words. */
  produces: string;
  maxAgeMinutes: number;
  /** The cadence read from scheduler.ts that justifies maxAgeMinutes. */
  reason: string;
  /** What the operator should look at first. */
  firstCheck: string;
}

/** What a reader measured. The age is computed in SQL; the reader converts it with the same nowMs. */
export interface QueueAgeRead {
  oldestDueAtMs: number | null;
  readFailed: boolean;
  error?: string;
  skipped?: string;
}

export const QUEUE_AGE_DECLARATIONS: readonly QueueAgeDeclaration[] = Object.freeze([
  {
    loop: "reminder-queue",
    produces: "maintenance reminders due and still `scheduled`",
    maxAgeMinutes: 24 * 60,
    reason:
      "hourly tier, every 2h, businessHoursOnly (07:00-20:59 ET): the longest legitimate wait is ~12h overnight, so 24h is twice the worst gap.",
    firstCheck:
      "SELECT the oldest service_reminders row with status='scheduled' and nextDueDate <= NOW(); a row that fails to send stays `scheduled` and is retried every tick, so check sendSms's result for that phone.",
  },
  {
    loop: "followup-cadence",
    produces: "follow-up touches (d7/d30/d60) past due with no voice_followups row",
    maxAgeMinutes: 72 * 60,
    reason:
      "hourly tier, every 2h, businessHoursOnly plus the job's own 09:00-18:00 ET call window and a daily cap (default 10): ~17h overnight gap, 72h tolerates a capped backlog for three days.",
    firstCheck:
      "Read the last followup-cadence cron_log details (placed/skipped/failed/cap); a daily cap below the completion rate grows the backlog without any failure.",
  },
  {
    loop: "reel-pipeline",
    produces: "reel jobs in queued, generating, assets_ready or assembling",
    maxAgeMinutes: 6 * 60,
    reason:
      "pulse tier, every 15 min: one generation (~11 min) and up to three assemblies per pulse, in-flight rows recovered after 12 min; 6h is 24 pulses with no movement.",
    firstCheck:
      "Check the reel-pipeline details for a provider preflight abort (Higgsfield session or credits) and the oldest non-terminal reel_jobs row's error and attempts.",
  },
  {
    loop: "reel-pipeline:publish",
    produces: "publish claims (publishing / publish_ambiguous) that never reached posted",
    maxAgeMinutes: 2 * 60,
    reason:
      "pulse tier, every 15 min: a publishing claim moves to publish_ambiguous after 12 min and the reconcile lane runs every pulse; 2h is 8 pulses unresolved.",
    firstCheck:
      "Open the job in the admin and reconcile with Meta before any retry: the post may be LIVE. Instagram has no idempotency key, so a blind retry double-posts.",
  },
]);

/**
 * Pure. Order matters: a failed read is unknown before anything else, so no
 * value that rode along with a failure can read as healthy or as stuck.
 */
export function classifyQueueAge(
  input: { oldestDueAtMs: number | null; readFailed: boolean; skipped?: string; nowMs: number },
  decl: QueueAgeDeclaration,
): { verdict: QueueAgeVerdict; ageMinutes: number | null } {
  if (input.readFailed) return { verdict: "unknown", ageMinutes: null };
  if (input.skipped) return { verdict: "skipped", ageMinutes: null };
  if (input.oldestDueAtMs === null) return { verdict: "empty", ageMinutes: null };
  if (!Number.isFinite(input.oldestDueAtMs) || !Number.isFinite(input.nowMs)) {
    return { verdict: "unknown", ageMinutes: null };
  }
  const ageMinutes = (input.nowMs - input.oldestDueAtMs) / 60_000;
  return { verdict: ageMinutes > decl.maxAgeMinutes ? "stuck" : "in-spec", ageMinutes };
}

/** One grouped Telegram section for every stuck queue in this pass. */
export function formatQueueAgeAlertGroup(
  items: readonly { declaration: QueueAgeDeclaration; ageMinutes: number }[],
): string {
  const lines = items.map(
    ({ declaration: d, ageMinutes }) =>
      `• \`${d.loop}\` → stuck · oldest ${d.produces} is ${Math.round(ageMinutes)}m old (limit ${d.maxAgeMinutes}m) · check: ${d.firstCheck}`,
  );
  return `⏳ Stuck queues · ${items.length} loop(s)\nThe job reports completed, but its oldest due row is not moving.\n${lines.join("\n")}`;
}
