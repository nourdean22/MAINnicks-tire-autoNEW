/**
 * Tier startup claim · a tier whose last run is a full interval old fires at boot (2026-09-22)
 *
 * WHY THIS EXISTS. Every tier's recurring tick is a `setInterval` that starts
 * counting at process boot. A tier whose interval is longer than the gap
 * between deploys therefore never reaches its first tick: on 2026-09-22 the
 * hourly tier (2 h — voice-recovery, enrich-customer-data, feedback-cycle,
 * safety-check, the statenour syncs, ten jobs) last ran at 12:29Z and was
 * still silent at 20:00Z across thirteen deploys, the longest uptime between
 * them under two hours. The same shape shows on every busy deploy day
 * (09-18: gaps of 4.2 h and 11.6 h; 09-21: 3.6 h). The 5-minute and 15-minute
 * tiers were fine, which is why nobody noticed.
 *
 * Until now only heartbeat, pulse and daily fired at boot — daily behind a
 * "last run < 20 h ago" guard, because re-firing it on every restart had
 * re-sent retention SMS. The rule here is that guard, generalised: a tier
 * fires at boot when its last run is at least one interval old (daily keeps
 * its 20 h allowance so restart drift cannot slide it a day), or when it has
 * never run. The interval timer still owns the cadence after that.
 *
 * THE CLAIM IS THE DECISION (review of #2516, P1). The first cut read the age
 * with a SELECT and then ran the tier. Two replicas booting on a stale row
 * could both read "due" before either wrote, and the per-job lock only stops
 * simultaneous execution — the lagging replica re-runs each job as the faster
 * one releases it. So the boot pass is now claimed by ONE conditional UPDATE
 * that stamps `last_run_at` only while the row is still older than the
 * allowance; a row can be changed once, so exactly one process fires. A tier
 * that has never run has no row, and creating the row (INSERT IGNORE) is that
 * tier's claim for the same reason. No claim, no fire: when the database
 * cannot be reached the tier waits for its interval — the daily tier firing
 * unclaimed is the retention-SMS re-send the original guard exists to prevent.
 *
 * WHAT IS NOT DONE, AND WHY (review P2). `resetSkipCount` stamps the tier at
 * the START of a pass, so a deploy that kills a pass mid-way leaves a fresh
 * stamp and the next boot skips the jobs that never ran. Measured: the first
 * live boot pass after this shipped ran the full 35-job hourly tier in 89 s
 * ("Tier hourly: 29 completed, 6 skipped (88936ms)", 2026-09-22 21:00Z) — an
 * earlier figure of 3–4 s in the review thread summed four named jobs, not the
 * tier, and is wrong. At thirteen deploys a day the mid-pass window is about
 * 1.3 % of the day. Reclaiming a killed pass would re-run the jobs that DID
 * complete, and the briefings tier's send jobs are deliberately not
 * once-per-shop-day (see nick-morning-brief) — a reclaim there is a duplicate
 * brief. The stamp stays at pass start; the residual is stated here rather
 * than hidden, and the 89 s is the number to revisit it against.
 *
 * Ages are computed in SQL (TIMESTAMPDIFF against NOW()), because a
 * driver-parsed TIMESTAMP on this stack arrives shifted by the server's zone,
 * and a 22-hour-old run read as 18 hours old is exactly how the old daily
 * guard could skip a due run.
 */
import { sql, type SQL } from "drizzle-orm";
import { isCronDraining } from "./index";

/** The one database method this module needs — injected so tests drive it without a connection. */
export interface StartupExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** Daily's boot allowance: a 24 h tier that restarted 20 h after its run is due. */
const DAILY_STARTUP_ALLOWANCE_MS = 20 * 3600_000;

export function startupAllowanceMs(tierName: string, intervalMs: number): number {
  return tierName === "daily" ? DAILY_STARTUP_ALLOWANCE_MS : intervalMs;
}

/** mysql2 answers a write with [ResultSetHeader, fields]; drizzle hands that through, some wrappers unwrap it. */
function affectedRows(result: unknown): number {
  const head = Array.isArray(result) ? result[0] : result;
  const n = (head as { affectedRows?: unknown } | null | undefined)?.affectedRows;
  return typeof n === "number" ? n : Number(n ?? 0) || 0;
}

export type StartupClaim =
  | { claimed: true; via: "created" | "stamped" }
  | { claimed: false; via: "not-due" | "draining" };

/**
 * Claim this tier's boot pass. Exactly one process can succeed per allowance
 * window: the state row is created once, and the stamp UPDATE changes the
 * row only while `last_run_at` is still at least `allowanceMs` old.
 *
 * DRAINING (F5, post-merge audit of #2651). runTier starts nothing once the
 * SIGTERM drain has begun, so a claim taken while draining is a slot spent on
 * a pass that never runs — and the replacement container then reads the slot
 * as taken. A boot-stagger timer is not cleared on stop and a wall-clock check
 * can be mid-await when SIGTERM lands, so both happened. So no claim is
 * attempted once draining, and a claim that SIGTERM overtook during its own
 * queries is handed back (releaseStartupPass) before returning. The drain flag
 * is the DEFAULT, so every caller gets this without wiring; tests inject one.
 */
export async function claimStartupPass(
  d: StartupExecutor,
  tierName: string,
  allowanceMs: number,
  isDraining: () => boolean = isCronDraining,
): Promise<StartupClaim> {
  if (isDraining()) return { claimed: false, via: "draining" };
  const allowanceSec = Math.max(0, Math.floor(allowanceMs / 1000));
  const created = await d.execute(
    sql`INSERT IGNORE INTO cron_tier_skip_state (tier_name, consecutive_skips, last_run_at, updated_at) VALUES (${tierName}, 0, NOW(), NOW())`,
  );
  let claim: StartupClaim;
  if (affectedRows(created) === 1) {
    claim = { claimed: true, via: "created" };
  } else {
    const stamped = await d.execute(sql`
      UPDATE cron_tier_skip_state
      SET last_run_at = NOW(), updated_at = NOW()
      WHERE tier_name = ${tierName}
        AND (last_run_at IS NULL OR TIMESTAMPDIFF(SECOND, last_run_at, NOW()) >= ${allowanceSec})
    `);
    claim = affectedRows(stamped) === 1 ? { claimed: true, via: "stamped" } : { claimed: false, via: "not-due" };
  }
  if (claim.claimed && isDraining()) {
    await releaseStartupPass(d, tierName, allowanceSec);
    return { claimed: false, via: "draining" };
  }
  return claim;
}

/**
 * Slack on a release. The next claimant computes its own allowance from its own
 * clock (a wall-clock slot's allowance grows with time since the opening), so a
 * stamp rewound to exactly our allowance could read one rounded second short.
 * Rewinding further is harmless: the pass was due, and it did not run.
 */
const RELEASE_SLACK_SEC = 600;

/**
 * Hand back a claim this process took but will not run: rewind the stamp to
 * more than one allowance old, so the next claimant's `>= allowance` test
 * passes. Only a stamp still younger than the allowance is touched — i.e. the
 * one just written; nobody else can have claimed over it inside that window.
 */
async function releaseStartupPass(d: StartupExecutor, tierName: string, allowanceSec: number): Promise<void> {
  const rewindSec = Math.floor(allowanceSec) + RELEASE_SLACK_SEC;
  await d.execute(sql`
    UPDATE cron_tier_skip_state
    SET last_run_at = DATE_SUB(NOW(), INTERVAL ${sql.raw(String(rewindSec))} SECOND), updated_at = NOW()
    WHERE tier_name = ${tierName}
      AND TIMESTAMPDIFF(SECOND, last_run_at, NOW()) < ${allowanceSec}
  `);
}

/** Informational, for the boot log line: age of the tier's last stamped run. `null` = no row. */
export async function readLastRunAgeMs(d: StartupExecutor, tierName: string): Promise<number | null> {
  const result = await d.execute(
    sql`SELECT TIMESTAMPDIFF(SECOND, last_run_at, NOW()) AS ageSec FROM cron_tier_skip_state WHERE tier_name = ${tierName}`,
  );
  const rows = Array.isArray(result) && !Array.isArray(result[0]) ? result : (result as unknown[])[0];
  const first = Array.isArray(rows) ? (rows[0] as { ageSec?: unknown } | undefined) : undefined;
  const ageSec = first?.ageSec;
  return ageSec == null ? null : Number(ageSec) * 1000;
}

/** Past the due moment, so the claim's whole-second TIMESTAMPDIFF reads "due" despite rounding. */
const DUE_CHECK_SLACK_MS = 15_000;

/**
 * A tier that was NOT due at boot gets one claimed check at the moment it falls
 * due, and its interval timer starts from that check (2026-10-08).
 *
 * Before, the interval started at boot, so a tier that was not due waited a
 * FULL interval after every deploy, and a deploy before that tick reset the
 * wait. A run slid to almost twice the interval: on 2026-10-08 the 2-hour tier
 * (missed-call recovery, callback escalation, stale-lead follow-up,
 * confirmation calls) ran at 10:17, 12:28, 15:17 and 18:26Z — 131, 168 and
 * 189 minutes apart — across fourteen boots, none of whose containers lived
 * the two hours its timer needed.
 *
 * The check claims exactly like the boot pass (claimStartupPass), so of two
 * processes alive at that moment one runs it. Null means "start the interval
 * now", the old behaviour, whenever there is nothing to align to: the boot pass
 * was claimed (it is running now), the claim could not be attempted, the server
 * is draining, or the age of the last run is unknown.
 */
export function firstTickDelayMs(ctx: { allowanceMs: number; lastRunAgeMs: number | null; claim: StartupClaim | null }): number | null {
  if (!ctx.claim || ctx.claim.claimed || ctx.claim.via !== "not-due") return null;
  if (ctx.lastRunAgeMs == null || ctx.lastRunAgeMs >= ctx.allowanceMs) return null;
  return ctx.allowanceMs - ctx.lastRunAgeMs + DUE_CHECK_SLACK_MS;
}

/** The due check's fire/skip decision and its log line (the boot pass has describeStartup). */
export function describeDueCheck(claim: StartupClaim | null, claimError: string | null): { fire: boolean; reason: string } {
  if (claim?.claimed) return { fire: true, reason: "claimed the pass it fell due for — the interval timer starts now" };
  if (claim?.via === "draining") return { fire: false, reason: "server is shutting down — no claim taken" };
  if (!claim) return { fire: false, reason: `could not claim (${claimError ?? "no database"}) — no claim, no fire; the interval timer starts now` };
  return { fire: false, reason: "another process ran it first — the interval timer starts now" };
}

export interface StartupContext {
  tierName: string;
  allowanceMs: number;
  /** The claim result, or `null` when the claim could not be attempted at all. */
  claim: StartupClaim | null;
  /** Read before the claim, for the message only — the claim decides. */
  lastRunAgeMs: number | null;
  claimError?: string | null;
}

/** Turn a claim into the fire/skip decision and the one log line the operator reads. */
export function describeStartup(ctx: StartupContext): { fire: boolean; reason: string } {
  const allowanceMin = Math.round(ctx.allowanceMs / 60000);
  const age = ctx.lastRunAgeMs == null ? "no recorded run" : `last run ${Math.round(ctx.lastRunAgeMs / 60000)} min ago`;
  if (ctx.claim?.claimed) {
    return {
      fire: true,
      reason: ctx.claim.via === "created"
        ? "never ran — created its state row, which is the claim"
        : `claimed the boot pass — ${age} ≥ allowance ${allowanceMin} min`,
    };
  }
  if (ctx.claim?.via === "draining") {
    return { fire: false, reason: "server is shutting down — no claim taken (or it was handed back); the next container decides" };
  }
  if (!ctx.claim) {
    return { fire: false, reason: `could not claim (${ctx.claimError ?? "no database"}) — no claim, no fire; the interval timer owns it` };
  }
  if (ctx.lastRunAgeMs == null || ctx.lastRunAgeMs >= ctx.allowanceMs) {
    return { fire: false, reason: `${age} ≥ allowance ${allowanceMin} min but another process claimed the pass first` };
  }
  return { fire: false, reason: `${age} < allowance ${allowanceMin} min — the interval timer owns it` };
}
