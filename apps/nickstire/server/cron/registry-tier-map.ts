/**
 * Which legacy-registry cron names are genuinely covered by a tier, and which
 * are stranded.
 *
 * ─── The incident this encodes ─────────────────────────────────────────
 *
 * `docs/admin-surface-audit/code-underneath-audit-logic.md` found two crons
 * (`confirmation-calls`, `voice-recovery`) registered in `registerAllJobs()`
 * but present in no scheduler tier — so they could never fire. Both were
 * fixed. The same table then added a completeness clause:
 *
 *   > "every job in it duplicates a tiered job EXCEPT the two above"
 *
 * That sentence closed the question, and the class stopped being swept. It was
 * false. Measured 2026-08-23 against origin/main: 33 registry jobs, 8 absent
 * from every tier BY NAME. Six were name mismatches with real coverage. Two
 * were genuinely dead, and production `cron_log` confirmed it — `campaign-resume`
 * and `sms-learning-digest` had ZERO rows, ever, while control jobs in the same
 * table showed 2,344 / 799 / 38 runs.
 *
 * So this file exists to make that a CHECK instead of a claim. A doc sentence
 * cannot notice a ninth stranded cron; `cron-wiring.test.ts` can.
 *
 * ─── Why the allowlist names its cover, and why that matters ───────────
 *
 * A bare list of "names that are allowed to be missing" is a guard whose
 * failure mode is silent permission: it would keep passing after the covering
 * tier job was renamed or deleted, which is the exact class of defect it was
 * built to catch. So each entry names the tier job that actually does the work,
 * and the check verifies THAT job is itself tier-wired. An entry outlives its
 * justification for exactly zero deploys.
 *
 * The check also rejects a REDUNDANT entry — one whose name did make it into a
 * tier — so the list cannot quietly accumulate permanent excuses.
 *
 * Exact names only. No patterns, no prefixes: a pattern that matched
 * `retention-*` would have silently absorbed a genuinely stranded
 * `retention-30day` the day someone added one.
 */

/**
 * Extract the SCHEDULED JOB names from cron/scheduler.ts source.
 *
 * Caught in review on #1808. The first version matched every `name: "..."`
 * property, which also swept up the five TIER labels - `heartbeat`, `pulse`,
 * `hourly`, `daily`, `briefings`. A tier is not a job, so a registry job named
 * `daily` with no tier job of that name, or an alias whose `coveredBy` is
 * `daily`, produced zero faults and defeated the completeness gate entirely -
 * while the aggregate parse check stayed green. A guard whose failure mode is
 * silent permission is the worst kind, and this one was written to catch
 * exactly that class.
 *
 * Measured on the source at the time of the fix: 122 total `name:` matches,
 * 5 tier declarations, 117 real jobs. No registry name collides with a tier
 * label TODAY, so nothing was actually mis-scored - but the gate was one
 * unlucky name away from passing over a stranded cron.
 *
 * Exclusion is POSITIONAL, not by name: a tier declaration is a `name:`
 * immediately followed by `intervalMs:`. Subtracting by NAME would have
 * silently dropped a legitimate job that happened to share a tier's label,
 * trading a false negative for a different false negative.
 *
 * Both the vitest canary and scripts/lint-cron-wiring.ts call this, so the
 * gate and the suite cannot disagree about what counts as a scheduled job.
 */
export function extractTierJobNames(schedulerSource: string): Set<string> {
  const tierDeclarationOffsets = new Set(
    [...schedulerSource.matchAll(/name: "[a-z0-9-]+",\s*intervalMs:/g)].map((m) => m.index),
  );
  const names = [...schedulerSource.matchAll(/name: "([a-z0-9-]+)"/g)]
    .filter((m) => !tierDeclarationOffsets.has(m.index))
    .map((m) => m[1]);
  return new Set(names);
}

/** Extract the registered job names from cron/index.ts source. */
export function extractRegistryJobNames(registrySource: string): string[] {
  return [...registrySource.matchAll(/registerJob\("([a-z0-9-]+)"/g)].map((m) => m[1]);
}


export interface RegistryTierAlias {
  /** Name as registered in `registerAllJobs()` (cron/index.ts). */
  registryName: string;
  /** Tier job (cron/scheduler.ts) that actually performs this work. */
  coveredBy: string;
  /** Evidence that the two are the same work — checked by hand, cited. */
  reason: string;
}

/**
 * Verified 2026-08-23 by reading both handlers, not by name similarity.
 * Every entry below was confirmed to call the same exported function.
 */
export const REGISTRY_TIER_ALIASES: readonly RegistryTierAlias[] = [
  {
    registryName: "retention-7day",
    coveredBy: "retention-all",
    reason: "retention-all awaits processRetention7Day() (scheduler.ts, retention-all handler)",
  },
  {
    registryName: "retention-14day",
    coveredBy: "retention-all",
    reason: "retention-all awaits processRetention14Day()",
  },
  {
    registryName: "retention-90day",
    coveredBy: "retention-all",
    reason: "retention-all awaits processRetention90Day()",
  },
  {
    registryName: "retention-180day",
    coveredBy: "retention-all",
    reason: "retention-all awaits processRetention180Day()",
  },
  {
    registryName: "retention-365day",
    coveredBy: "retention-all",
    reason: "retention-all awaits processRetention365Day()",
  },
  {
    registryName: "statenour-sync",
    coveredBy: "statenour-live-sync",
    reason: "both handlers call syncToStatenour() from cron/jobs/statenourSync",
  },
] as const;

export type CronWiringFaultKind =
  /** Registry job is enabled, in no tier, and has no alias. It cannot run. */
  | "unwired"
  /** An alias points at a covering job that is itself in no tier. */
  | "stale-alias"
  /** An alias exists for a name that IS tier-wired — delete the entry. */
  | "redundant-alias";

export interface CronWiringFault {
  kind: CronWiringFaultKind;
  jobName: string;
  message: string;
}

/**
 * Pure — takes the two name sets so tests can probe it without booting the
 * scheduler, and so the same logic backs both the runtime watchdog and the
 * build-time check. Both callers pass real data; only tests pass fixtures.
 *
 * @param registryJobs  from `getRegisteredJobNames()` (cron/index.ts)
 * @param tierJobNames  keys of `getJobCadences()` (cron/scheduler.ts)
 */
export function findCronWiringFaults(
  registryJobs: ReadonlyArray<{ name: string; enabled: boolean }>,
  tierJobNames: ReadonlySet<string>,
  aliases: readonly RegistryTierAlias[] = REGISTRY_TIER_ALIASES,
): CronWiringFault[] {
  const faults: CronWiringFault[] = [];
  const aliasByName = new Map(aliases.map((a) => [a.registryName, a]));

  for (const job of registryJobs) {
    if (!job.enabled) continue;
    if (tierJobNames.has(job.name)) continue;

    const alias = aliasByName.get(job.name);
    if (!alias) {
      faults.push({
        kind: "unwired",
        jobName: job.name,
        message:
          `CRON WIRED TO NO TIER: ${job.name} is enabled in the registry but belongs to no ` +
          `scheduler tier — it cannot run. Add it to a tier in cron/scheduler.ts, or, if a ` +
          `differently-named tier job already does this work, add an alias in ` +
          `cron/registry-tier-map.ts naming that job.`,
      });
      continue;
    }

    // The alias is only as good as the job it points at. If THAT job is gone,
    // the work is stranded again and the allowlist would have hidden it.
    if (!tierJobNames.has(alias.coveredBy)) {
      faults.push({
        kind: "stale-alias",
        jobName: job.name,
        message:
          `CRON ALIAS IS STALE: ${job.name} is excused because "${alias.coveredBy}" was supposed ` +
          `to cover it (${alias.reason}), but "${alias.coveredBy}" is in no tier either. The work ` +
          `is stranded and the alias was hiding it.`,
      });
    }
  }

  // An alias for a name that IS wired is drift. Left alone, the list becomes a
  // pile of permanent excuses nobody re-reads.
  for (const alias of aliases) {
    if (tierJobNames.has(alias.registryName)) {
      faults.push({
        kind: "redundant-alias",
        jobName: alias.registryName,
        message:
          `CRON ALIAS IS REDUNDANT: ${alias.registryName} is now wired to a tier under its own ` +
          `name, so its alias in cron/registry-tier-map.ts is dead weight — delete the entry.`,
      });
    }
  }

  return faults;
}
