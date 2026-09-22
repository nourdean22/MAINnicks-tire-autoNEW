/**
 * Should a tier fire when the process boots?
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
 * Pure. The caller supplies the age it read from cron_tier_skip_state — in
 * SQL (TIMESTAMPDIFF against NOW()), because a driver-parsed TIMESTAMP on
 * this stack arrives shifted by the server's zone, and a 22-hour-old run read
 * as 18 hours old is exactly how the old daily guard could skip a due run.
 */

export interface TierStartupInput {
  /** Tier name — "daily" keeps its documented 20 h allowance. */
  tierName: string;
  /** The tier's recurring interval. */
  intervalMs: number;
  /**
   * Age of the tier's last completed run in ms, computed in SQL. `null` when
   * the tier has never run (no row) or the state could not be read — both
   * mean "fire": a tier that cannot prove it ran recently must run.
   */
  lastRunAgeMs: number | null;
}

/** Daily's boot allowance: a 24 h tier that restarted 20 h after its run is due. */
const DAILY_STARTUP_ALLOWANCE_MS = 20 * 3600_000; // module-private: an export imported only by its test is what the orphan gate exists to catch

export function shouldFireOnStartup(input: TierStartupInput): { fire: boolean; reason: string } {
  const allowance = input.tierName === "daily" ? DAILY_STARTUP_ALLOWANCE_MS : input.intervalMs;
  if (input.lastRunAgeMs == null) return { fire: true, reason: "no recorded run — a tier that cannot prove it ran recently must run" };
  if (input.lastRunAgeMs >= allowance) {
    return { fire: true, reason: `last run ${Math.round(input.lastRunAgeMs / 60000)} min ago ≥ allowance ${Math.round(allowance / 60000)} min` };
  }
  return { fire: false, reason: `last run ${Math.round(input.lastRunAgeMs / 60000)} min ago < allowance ${Math.round(allowance / 60000)} min — the interval timer owns it` };
}
