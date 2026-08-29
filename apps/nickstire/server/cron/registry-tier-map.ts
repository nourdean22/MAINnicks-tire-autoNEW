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

/**
 * Jobs deliberately held OFF the scheduler and reachable only by hand.
 *
 * ─── Staged is not disabled, and the difference is the whole point ─────
 *
 * `enabled: false` is read in exactly one place: the tier loop in
 * scheduler.ts. Neither manual runner consults it — `runTierJobByName`
 * (scheduler.ts) and `runJobByName` (cron/index.ts, behind
 * POST /api/admin/run-staged-cron) each look the job up by name and call its
 * handler. NOT the bridge: /api/bridge/run-job 403s on any name outside
 * BRIDGE_RUN_JOB_ALLOWLIST, which deliberately excludes SMS-capable jobs —
 * so the ONLY reachable trigger is the admin endpoint, and a canary asserts
 * it stays wired to this list.
 * So a staged job is one keystroke from running, and its first run is
 * observed. Confirm before trusting that sentence:
 *
 *     git grep -n "enabled" -- apps/nickstire/server/cron/scheduler.ts
 *
 * The failure mode this list guards against is the opposite of the one the
 * aliases above guard: not a job that can never fire, but a job that was meant
 * to be watched and quietly went automatic. `enabled: false` sitting alone in
 * scheduler.ts is indistinguishable from someone having disabled a broken job
 * and forgotten it. An entry here states which it is, and the canary in
 * cronControlPlane.test.ts fails if the two ever disagree in either direction.
 */
export interface ManualTriggerStagedJob {
  /** Tier job name in cron/scheduler.ts. */
  name: string;
  /** Why this one is not allowed to fire unattended. */
  why: string;
  /** What has to be true before the `enabled: false` line comes out. */
  promote: string;
}

export const MANUAL_TRIGGER_STAGED: readonly ManualTriggerStagedJob[] = [
  {
    name: "reel-pipeline",
    why:
      "NOT staged for flakiness - staged because the only Higgsfield lane funded by the " +
      "operator's paid subscription requires a human browser login. Verified on his account " +
      "2026-08-29: consumer/Ultra holds 1,934.62 credits and is what the CLI session lane spends; " +
      "Higgsfield Cloud API (Authorization: Key ID:SECRET) is a SEPARATE paid product holding ZERO " +
      "credits, with no payment method and 0 API calls lifetime despite 2 keys already existing. " +
      "The Ultra subscription does not fund the API lane, so the API keys are not an escape hatch - " +
      "provisioning them would authenticate cleanly and then fail at generation on a zero balance. " +
      "The session lane needs `higgsfield auth login` in a browser, which no cron can do, so " +
      "generation becomes a human-triggered batch instead of an unattended job that dies between logins.",
    promote:
      "the LEDGER fact changes, not the failure rate: either Higgsfield Cloud API credits are " +
      "purchased and HIGGSFIELD_API_KEY_ID/SECRET are set (higgsfieldStudio prefers that lane " +
      "automatically when configured), or Higgsfield ships a non-interactive credential for the " +
      "consumer ledger. Promoting because 'it looks stable now' re-creates a cron that dies " +
      "silently the next time the refresh token is revoked.",
  },
  {
    name: "higgsfield-session-keepalive",
    why:
      "exists only to rotate the CLI session token before reel-pipeline renders. With generation " +
      "staged there is nothing to keep alive between batches, and left on schedule it re-fails every " +
      "15 minutes against the same dead session - 296 failed runs in 72h measured 2026-08-29, which " +
      "is half of the ~50 Telegram alerts delivered in three days. Staging one of this pair without " +
      "the other is the half-done shape review caught on PR #1830.",
    promote:
      "promote together with reel-pipeline and never before it - a keepalive for a job that does not " +
      "run is pure alert noise pointed at a session nothing is using.",
  },
  {
    name: "campaign-resume",
    why:
      "can call processCampaignSends() for a campaign still 'active' with rows left 'pending', " +
      "and SMS_KILL_SWITCH does not gate it (Twilio-only; the shop gateway path stays live). " +
      "A job that reaches customers gets an observed first run.",
    promote:
      "one manual run via POST /api/admin/run-staged-cron observed against a REAL stranded campaign " +
      "(0 pending rows existed at staging time, so the 558 automatic runs proved nothing).",
  },
  {
    name: "sms-learning-digest",
    why:
      "sole producer of sms_learning_recommendations, whose admin panel has rendered an empty " +
      "list since it shipped. Texts nobody, but the first real batch is the one worth reading " +
      "before it lands unattended.",
    promote:
      "one manual Monday run that actually crosses the threshold, with the resulting " +
      "recommendation rows reviewed in the admin panel.",
  },
];

/**
 * Tier jobs carrying `enabled: false`, parsed from scheduler.ts source.
 *
 * Matches the flag ONLY where it directly follows the job's own `name:` line,
 * which is where the house style puts it. A job that grew the flag somewhere
 * else in its object literal reads here as NOT staged, so the canary goes red
 * and someone looks — the safe direction for a parser to be wrong in. A
 * parser that guessed generously would report a job as staged while the
 * scheduler fired it, which is the exact lie this file exists to prevent.
 */
export function extractDisabledTierJobNames(schedulerSource: string): Set<string> {
  return new Set(
    [...schedulerSource.matchAll(/name: "([a-z0-9-]+)",\s*enabled:\s*false\b/g)].map((m) => m[1]),
  );
}
