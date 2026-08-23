/**
 * Cron status, read from the LIVE source.
 *
 * ─── Why this module exists ────────────────────────────────────────────
 *
 * `cron/index.ts` was decommissioned by making its ENTRYPOINT throw
 * (`startAllJobs()`) while leaving its STATE readable (`getJobStatuses()`
 * returning `job.lastRun`). A thrown entrypoint is loud. A stale readable
 * state is silent — and four consumers kept reading it:
 *
 *   1. services/selfHealing.ts     — fixed 2026-08 (reads cron_log directly)
 *   2. routes/adminRoutes.ts       — NOT fixed: `/api/admin/cron-status`
 *   3. _core/bridge-routes.ts      — NOT fixed: `/api/bridge/cron-status`
 *   4. selfHealing resetJobRunningFlag auto-fix — dead predicate
 *
 * `job.lastRun` was assigned at exactly one line (`cron/index.ts` inside
 * `runJob()`), and `runJob()` had ZERO call sites. So every one of the 33
 * registered jobs reported `lastRun: null`, in every process, forever —
 * while the tiered scheduler ran ~288 jobs a day. The post-deploy checklist
 * (`docs/ncsos-post-deploy-checklist.md`) told the operator to verify cron
 * health with surface 2.
 *
 * The fix is the class, not the four symptoms: the dead execution path and
 * its state are deleted together, and every reader moves here. `cron_log` is
 * the only record that reflects whether a job actually ran — the same source
 * selfHealing already used, hoisted so there is ONE implementation.
 *
 * ─── The distinction this module keeps ─────────────────────────────────
 *
 * `observable: false` means "we could not read cron_log", which is NOT the
 * same as "nothing ran". An unreadable log must never render as a fleet of
 * silent jobs — that ambiguity is what made the old surface dangerous. Every
 * caller must branch on it.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("cron-status");

export interface CronJobStatus {
  name: string;
  /** Scheduler tier that owns this job. `null` = in no tier, so it CANNOT run. */
  tier: string | null;
  /** Cadence of the owning tier. `null` when the job belongs to no tier. */
  intervalMin: number | null;
  businessHoursOnly: boolean;
  oncePerShopDay: boolean;
  /**
   * Last COMPLETED run from cron_log. `null` means no completed row was
   * found — which is meaningful only when `observable` is true.
   */
  lastCompletedAt: string | null;
  /**
   * Set when this registry name is an ALIAS — the work runs under a
   * differently-named tier job, and `tier` / `intervalMin` / `lastCompletedAt`
   * above are that job's.
   *
   * Without this, the six aliased registry names (`retention-*`,
   * `statenour-sync`) resolved to `tier: null` on both endpoints, which this
   * module documents as "cannot run" — six permanent false wiring failures
   * introduced by the very change that repaired the surface. Caught in review
   * on #1805 before merge.
   */
  coveredBy: string | null;
}

export interface CronStatusReport {
  /**
   * False when cron_log could not be read. When false, every `lastCompletedAt`
   * is null for lack of data, NOT for lack of runs — do not render staleness.
   */
  observable: boolean;
  /**
   * False when the tiered scheduler has not started in THIS process. When
   * false, `tier` is null everywhere for lack of a registry, NOT because the
   * jobs are unwired.
   */
  schedulerStarted: boolean;
  jobs: CronJobStatus[];
}

/**
 * Last successful completion per job name, read from cron_log — the only
 * record that actually reflects whether a job ran.
 *
 * Returns null when the log cannot be read. Callers MUST treat null as
 * "cannot tell", never as "nothing ran": an empty map would make every
 * registered job look permanently silent and fire an alert for all of them
 * on a transient DB fault.
 *
 * Hoisted verbatim from services/selfHealing.ts so the admin and bridge
 * surfaces share ONE implementation rather than growing a third.
 */
export async function loadLastCompletions(): Promise<Map<string, string> | null> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return null;
    const { sql } = await import("drizzle-orm");
    const [raw] = await db.execute(sql`
      SELECT job_name AS jobName, MAX(completed_at) AS lastCompletedAt
      FROM cron_log
      WHERE status = 'completed' AND completed_at IS NOT NULL
      GROUP BY job_name
    `);
    const out = new Map<string, string>();
    for (const row of raw as Array<Record<string, unknown>>) {
      const at = row.lastCompletedAt;
      if (at == null) continue;
      const parsed = at instanceof Date ? at : new Date(String(at));
      if (!Number.isNaN(parsed.getTime())) out.set(String(row.jobName), parsed.toISOString());
    }
    return out;
  } catch (err) {
    log.warn("[cron-status] cron_log completion read failed:", err);
    return null;
  }
}

/**
 * The live cron picture: which jobs a tier owns, and when each last COMPLETED.
 *
 * Union of two sources, deliberately:
 *   · scheduler tiers  — what can run, and how often
 *   · cron_log         — what did run, and when
 *
 * A job present in the legacy registry but in no tier appears with
 * `tier: null`. That is a WIRING fault and is exactly what the two crons
 * stranded on the retired `startAllJobs()` path looked like.
 */
/** Cadence shape returned by `getJobCadences()` in cron/scheduler.ts. */
export interface TierCadence {
  intervalMin: number;
  businessHoursOnly: boolean;
  oncePerShopDay: boolean;
  tier: string;
}

/**
 * PURE. Kept separate from `getCronStatus()` so alias resolution can be tested
 * by BEHAVIOUR rather than by grepping this file.
 *
 * That distinction is not academic: the first canary for this asserted the
 * source contained "REGISTRY_TIER_ALIASES" and "coveredBy", and a mutation
 * probe that replaced the whole resolution with `const coveredBy = null` left
 * every one of those strings in place and stayed GREEN. A source-text
 * assertion tests that code was written, never that it works.
 */
export function buildCronJobStatuses(
  registryJobs: ReadonlyArray<{ name: string; enabled: boolean }>,
  cadences: ReadonlyMap<string, TierCadence>,
  lastCompletions: ReadonlyMap<string, string> | null,
  aliases: readonly { registryName: string; coveredBy: string }[],
): CronJobStatus[] {
  const aliasByName = new Map(aliases.map((a) => [a.registryName, a.coveredBy]));

  // Union of both name sources so a job stranded in the registry is visible
  // rather than quietly absent from the report.
  const names = new Set<string>([
    ...cadences.keys(),
    ...registryJobs.filter((j) => j.enabled).map((j) => j.name),
  ]);

  return [...names].sort().map((name) => {
    // Resolve aliases BEFORE concluding a job is unwired. Six registry names
    // are covered by a differently-named tier job; reporting them as
    // `tier: null` would mean "cannot run" on a surface whose whole purpose is
    // to stop being confidently wrong. Their cadence and last completion are
    // the COVERING job's, because that is the thing that actually runs.
    const direct = cadences.get(name);
    const alias = direct ? null : aliasByName.get(name) ?? null;
    const cadence = direct ?? (alias ? cadences.get(alias) : undefined);
    const effectiveName = direct ? name : alias ?? name;

    return {
      name,
      tier: cadence?.tier ?? null,
      intervalMin: cadence?.intervalMin ?? null,
      businessHoursOnly: cadence?.businessHoursOnly ?? false,
      oncePerShopDay: cadence?.oncePerShopDay ?? false,
      lastCompletedAt: lastCompletions?.get(effectiveName) ?? null,
      // Only report a cover that actually resolved to a live tier. A stale
      // alias (covering job deleted) must still surface as tier: null, i.e.
      // as the wiring fault it is — findCronWiringFaults reports it by name.
      coveredBy: cadence && alias ? alias : null,
    };
  });
}

export async function getCronStatus(): Promise<CronStatusReport> {
  const { getJobCadences } = await import("./scheduler");
  const { getRegisteredJobNames } = await import("./index");
  const { REGISTRY_TIER_ALIASES } = await import("./registry-tier-map");

  const cadences = getJobCadences();
  const lastCompletions = await loadLastCompletions();

  return {
    observable: lastCompletions !== null,
    schedulerStarted: cadences.size > 0,
    jobs: buildCronJobStatuses(
      getRegisteredJobNames(),
      cadences,
      lastCompletions,
      REGISTRY_TIER_ALIASES,
    ),
  };
}
