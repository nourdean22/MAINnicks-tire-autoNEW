/**
 * Cron heartbeat watchdog · 2026-05-30
 *
 * The out-of-band LIVENESS monitor for the mega fan-out. This is the
 * canary that was MISSING when the fan-out went ~70% dead for 2 days
 * (2026-05-28 → 30) and nothing screamed — the only detection was a
 * human querying CronJobLog by hand. See
 * docs/postmortems/2026-05-30-cron-fanout-outage.md.
 *
 * WHY A DEDICATED INNGEST FUNCTION (not a fan-out child): if this lived
 * inside MORNING_JOBS, the very failure it watches for — a dead fan-out —
 * would starve the watchdog too. It MUST run out-of-band, on its own cron
 * trigger, independent of the fan-out's health.
 *
 * WHAT IT DOES: for every job in the fan-out arrays, read its last
 * CronJobLog run age. A daily job (MORNING/EVENING) silent > 26h, or a
 * weekly job (WEEKLY) silent > 8d, means a cron that should have fired
 * didn't. If any are silent → P0 Coach event (scoreboard + brain) +
 * Telegram.
 *
 * Liveness, NOT outcomes: it asserts "the expected crons actually ran,"
 * which no other surface does. A dead cron writes no row, so ABSENCE is
 * the signal — exactly what every outcome-based check misses.
 *
 * Future: extend to the other dedicated Inngest functions (goal-pruner,
 * morning-brief, …) — they can silently die too. Scoped here to the
 * fan-out, the subsystem that actually broke.
 */
import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { MORNING_JOBS, EVENING_JOBS, WEEKLY_JOBS } from "../jobs";
import { prisma } from "@/lib/prisma";
import { recordCoachEvent } from "@/lib/services/coach-events";
import { sendTelegram, formatTelegramNotification } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";
import { logError } from "@/lib/utils/error-log";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("inngest/cron-heartbeat");

const HOUR_MS = 3_600_000;
const DAILY_MAX_AGE_H = 26; // a daily fan-out job missed a cycle (24h + grace)
const WEEKLY_MAX_AGE_H = 24 * 8; // a weekly fan-out job missed a week

const nameOf = (path: string) =>
  path.replace(/^\/api\/cron\//, "").replace(/\?.*$/, "");

/**
 * Each fan-out job + its expected max silence. WEEKLY_JOBS only fire on
 * Sunday-ET (appended to the evening slot), so they get the 8-day window;
 * MORNING/EVENING members are daily. A job in both morning + evening is
 * daily (the looser of the two never applies).
 */
function expectedJobs(): { name: string; maxAgeH: number }[] {
  const daily = new Set([...MORNING_JOBS, ...EVENING_JOBS].map(nameOf));
  const out = [...daily].map((name) => ({ name, maxAgeH: DAILY_MAX_AGE_H }));
  for (const name of new Set(WEEKLY_JOBS.map(nameOf))) {
    if (!daily.has(name)) out.push({ name, maxAgeH: WEEKLY_MAX_AGE_H });
  }
  return out;
}

export interface SilentJob {
  name: string;
  ageH: number;
  maxAgeH: number;
}

export interface SilenceVerdict {
  silent: SilentJob[];
  /** Never-run jobs still inside their first expected window. Not an alarm. */
  newborn: string[];
  /**
   * Jobs that ARE running on schedule but have not logged a non-failed run in
   * twice their window. This lane exists because the silence check reads
   * MAX(createdAt) with no status filter, so a `failed` row counts as a run:
   * a job that runs and fails every time scores HEALTHIER than one that never
   * runs at all. `ingest-reviews` failed at 0 ms, four times a day, for sixteen
   * consecutive days, and the only cron alert in that window named five OTHER
   * jobs — all "(never)". It was absent from that list precisely because it was
   * running.
   */
  failing: FailingJob[];
}

/** A job whose runs land, and fail. */
export interface FailingJob {
  name: string;
  /** Hours since its last non-failed run; null when it has never had one. */
  lastOkAgeH: number | null;
  maxAgeH: number;
}

/**
 * 2026-08-20 · never-run needed a birth certificate. A cron with no log row
 * ever got `ageH = Infinity`, which always exceeds the window — so a job whose
 * CODE deployed 32 minutes earlier paged the operator P0 ("conversation-compile
 * (never). The mega fan-out may be broken") 15 hours before its first slot
 * could possibly fire. Every new fan-out cron would false-page on its first
 * 12:00Z heartbeat.
 *
 * There is no deploy timestamp to lean on (BUILD_TIME is unset on Railway), so
 * the watchdog keeps its own registry: the first time it SEES a job in the
 * expected list it records first-seen, and a never-run job only pages once its
 * first-seen is older than that job's own silence window. A genuinely dead new
 * cron still pages — one heartbeat later than before, which is the price of
 * not crying wolf. A job that HAS run is judged purely on its last run, as
 * before; the grace can only ever apply to the never-ran.
 */
/**
 * Jobs whose STEADY STATE is failure, excluded from the failing lane.
 *
 * THIS IS NOT A CONVENIENCE CARVE-OUT. The lane detects a REGRESSION: a job that
 * used to work and stopped. A job that has never worked cannot regress, so the
 * lane has nothing true to say about it — and saying it anyway destroys the alert.
 *
 * Measured 2026-08-22 over 30 days of cron_job_logs, and the first draft of this
 * file would have paged on both within about three days of merge:
 *
 *   ollama-model-liveness   23 non-failed of 2,333 runs (1.0%).
 *                           Longest unbroken failure streak: 2,308 runs.
 *   correlation-alarm       354 non-failed of 1,278 runs (27.7%).
 *                           320 failure streaks, 264 of them 3-or-longer.
 *
 * Both had a recent success on merge day, which is exactly what made this
 * dangerous: a "does it page today?" probe returns a clean no, and the alert
 * starts firing on most days a week later — training the operator to mute the
 * P0 this whole change exists to make audible.
 *
 * THE EXCLUSION IS ITSELF A FINDING. A liveness probe that fails 99% of the time
 * is not healthy; it is a broken dependency nobody has fixed or retired. This set
 * makes that visible instead of laundering it through an alert nobody reads.
 * Removing a name here is the correct move ONCE the underlying job is fixed — and
 * the canary in cron-heartbeat-failing-lane.test.ts asserts every name carries a
 * measured justification, so the set cannot quietly grow into a mute button.
 */
export const FAILURE_IS_STEADY_STATE: ReadonlySet<string> = new Set([
  "ollama-model-liveness",
  "correlation-alarm",
]);

export function classifySilence(
  expected: ReadonlyArray<{ name: string; maxAgeH: number }>,
  lastMsByName: ReadonlyMap<string, number | null>,
  firstSeenMsByName: ReadonlyMap<string, number>,
  nowMs: number,
  /**
   * Last NON-FAILED run per job. OPTIONAL and inert when omitted: absent means
   * `failing` is always empty and the first four parameters behave byte-for-byte
   * as before, so every existing caller and test is unaffected. Passing an empty
   * map would be a different thing entirely — it would read as "nothing has ever
   * succeeded" and page on every job at once, which is why absence is modelled as
   * undefined rather than as an empty map.
   */
  lastOkMsByName?: ReadonlyMap<string, number | null>,
): SilenceVerdict {
  const silent: SilentJob[] = [];
  const newborn: string[] = [];
  const failing: FailingJob[] = [];
  for (const e of expected) {
    const last = lastMsByName.get(e.name) ?? null;
    if (last != null) {
      const ageH = (nowMs - last) / HOUR_MS;
      if (ageH > e.maxAgeH) {
        silent.push({ name: e.name, ageH, maxAgeH: e.maxAgeH });
        continue;
      }
      // It IS running. Ask the second question the old check could not:
      // is it running SUCCESSFULLY? The 2x grace is deliberate — nine expected
      // jobs legitimately resolve { ok: false }, which cron-manager files as
      // status "failed" (data-source-health, ollama-model-liveness,
      // relationship-picks-prewarm, nick-action-proposal, correlation-alarm,
      // creation-spike-detect, cost-slo-check, intelligence, semantic-link).
      // One degraded night must not page. Sixteen days must.
      if (lastOkMsByName !== undefined && !FAILURE_IS_STEADY_STATE.has(e.name)) {
        const lastOk = lastOkMsByName.get(e.name) ?? null;
        const lastOkAgeH = lastOk == null ? null : (nowMs - lastOk) / HOUR_MS;
        if (lastOkAgeH === null || lastOkAgeH > e.maxAgeH * 2) {
          failing.push({ name: e.name, lastOkAgeH, maxAgeH: e.maxAgeH });
        }
      }
      continue;
    }
    const firstSeen = firstSeenMsByName.get(e.name);
    if (firstSeen === undefined || (nowMs - firstSeen) / HOUR_MS <= e.maxAgeH) {
      newborn.push(e.name);
      continue;
    }
    silent.push({ name: e.name, ageH: Infinity, maxAgeH: e.maxAgeH });
  }
  return { silent, newborn, failing };
}

const inngest = getInngest();

export const cronHeartbeat = inngest.createFunction(
  {
    id: "cron-heartbeat",
    name: "Cron heartbeat watchdog",
    retries: 2,
    // 12:00 UTC · 3h after the morning fan-out (09:00) and 9h after the
    // evening fan-out (03:00). A job that ran "today" is recent (≤9h); a
    // job that SKIPPED today is already > 26h old — clean separation
    // regardless of slot.
    triggers: [{ cron: "0 12 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    // 2026-07-28 cron-truth hardening · SELF-ROW FIRST. This watchdog
    // was itself invisible to Inngest Cloud for weeks (function-set
    // drift, docs/audits/2026-07-28-cron-truth.md) and left no trace of
    // its own absence. It now writes proof-of-invocation before doing
    // anything else — the row the worker's out-of-band
    // /api/cron/inngest-liveness check reads. If Inngest dies again,
    // this row goes stale and a NON-Inngest scheduler notices within a
    // day. Who watches the watcher: a different service, on purpose.
    await step.run("self-row", async () => {
      await prisma.cronJobLog
        .create({ data: { jobName: "cron-heartbeat", status: "success" } })
        .catch((e) => logError("inngest.cron-heartbeat", e, { stage: "self-row", risk: "liveness watchdog goes blind" }, "warn"));
      return true;
    });

    const expected = expectedJobs();
    const names = expected.map((e) => e.name);

    // Return serializable numbers (not Date objects) so the Inngest step
    // checkpoint survives JSON round-trip on retry.
    const lastRuns = await step.run("read-cronjoblog", async () => {
      // TWO reads, not one. The first is the ORIGINAL, unfiltered — do not add a
      // status filter to it. The absence signal it computes is correct and six
      // tests depend on it; filtering it would render a running-but-failing job
      // as "ingest-reviews (never)", and two of those escalate the body text to
      // "the mega fan-out itself may be down" — a worse lie than the silence.
      //
      // The second answers the question the first structurally cannot: not "did
      // it run" but "did it WORK". `not: "failed"` rather than `equals: "success"`
      // because `partial` is a live third status (mega-fanout writes it), and an
      // equals-filter would start false-paging the day a job legitimately reports
      // partial. Index already exists: @@index([jobName, status, createdAt]).
      const [anyRows, okRows] = await Promise.all([
        prisma.cronJobLog.groupBy({
          by: ["jobName"],
          where: { jobName: { in: names } },
          _max: { createdAt: true },
        }),
        prisma.cronJobLog.groupBy({
          by: ["jobName"],
          where: { jobName: { in: names }, status: { not: "failed" } },
          _max: { createdAt: true },
        }),
      ]);
      const ok = new Map(okRows.map((r) => [r.jobName, r._max.createdAt?.getTime() ?? null]));
      return anyRows.map((r) => ({
        name: r.jobName,
        lastMs: r._max.createdAt?.getTime() ?? null,
        lastOkMs: ok.get(r.jobName) ?? null,
      }));
    });
    const lastByName = new Map(lastRuns.map((r) => [r.name, r.lastMs]));
    const lastOkByName = new Map(lastRuns.map((r) => [r.name, r.lastOkMs]));

    // Birth registry for the never-ran (see classifySilence). Reads existing
    // first-seen rows, then registers any expected job not yet on record.
    // Returns null when the registry itself is unreachable — the caller then
    // treats every never-run job as ancient (epoch first-seen), i.e. the old
    // page-always behavior. Post-crash review 2026-08-20: the first version
    // returned {} on failure, which made every never-run job look like a
    // FIRST SIGHTING and granted it grace — a DB error would have silenced
    // the watchdog, the exact inversion of fail-toward-alerting.
    const firstSeen = await step.run("first-seen-registry", async (): Promise<Record<string, number> | null> => {
      const out: Record<string, number> = {};
      try {
        const rows = await prisma.brainMemory.findMany({
          where: {
            category: BRAIN_CATEGORIES.CRONS,
            key: { in: names.map((n) => `first-seen:${n}`) },
          },
          select: { key: true, content: true },
        });
        for (const r of rows) {
          const ms = Date.parse(r.content);
          if (!Number.isNaN(ms)) out[r.key.replace(/^first-seen:/, "")] = ms;
        }
        const nowIso = new Date().toISOString();
        for (const n of names) {
          if (out[n] !== undefined) continue;
          await prisma.brainMemory.create({
            data: {
              category: BRAIN_CATEGORIES.CRONS,
              key: `first-seen:${n}`,
              content: nowIso,
              source: "cron-heartbeat",
              createdBy: "system",
            },
          });
          out[n] = Date.parse(nowIso);
        }
      } catch (e) {
        logError("inngest.cron-heartbeat", e, { stage: "first-seen-registry", risk: "grace unavailable; never-run jobs will page (old behavior)" }, "warn");
        return null;
      }
      return out;
    });

    const now = Date.now();
    const { silent, newborn, failing } = classifySilence(
      expected,
      lastByName,
      firstSeen === null
        ? new Map(names.map((n) => [n, 0])) // registry down → epoch → page
        : new Map(Object.entries(firstSeen)),
      now,
      lastOkByName,
    );

    // Both lanes gate the early return. With only `silent` here, a perfect
    // classifier ships INERT: ingest-reviews is never silent, so the function
    // would compute `failing: ["ingest-reviews"]` and then return "heartbeat_ok"
    // without telling anyone. That is the repo's BUILT-TESTED-UNWIRED pattern,
    // and the wiring canary in the test file exists for exactly this line.
    if (silent.length === 0 && failing.length === 0) {
      log.info("heartbeat_ok", { checked: expected.length, newborn });
      return { checked: expected.length, silent: 0, failing: 0, newborn: newborn.length };
    }

    const detail = silent
      .slice(0, 8)
      .map((j) => `${j.name} (${j.ageH === Infinity ? "never" : Math.round(j.ageH) + "h"})`)
      .join(", ");
    // Two lanes, two runbooks, so they get two titles. "not firing" means the job
    // is not running; "failing every run" means it runs on schedule and never
    // works. Collapsing them into one message would reproduce the original defect
    // in prose: the operator would read "cron not firing" about a cron that fires
    // reliably, go look at the scheduler, find it healthy, and stop.
    const failDetail = failing
      .slice(0, 8)
      .map((j) => `${j.name} (${j.lastOkAgeH === null ? "no success on record" : "last ok " + Math.round(j.lastOkAgeH) + "h ago"})`)
      .join(", ");
    const title =
      silent.length > 0 && failing.length > 0
        ? `${silent.length} cron${silent.length > 1 ? "s" : ""} not firing, ${failing.length} failing every run`
        : silent.length > 0
          ? `${silent.length} cron${silent.length > 1 ? "s" : ""} not firing`
          : `${failing.length} cron${failing.length > 1 ? "s" : ""} failing every run`;
    // 2026-08-20 · "The mega fan-out may be broken" fired on a morning the
    // fan-out had run CLEAN three hours earlier. One silent job usually means
    // that job; only a cluster implicates the fan-out itself.
    const silentLine =
      silent.length === 0
        ? ""
        : `Expected crons with no recent run: ${detail}${silent.length > 8 ? " …" : ""}. ${
            silent.length > 1 ? "Several silent together — the mega fan-out itself may be down. " : ""
          }`;
    // The line that would have named ingest-reviews on roughly day three instead
    // of never. "Running but failing" is the whole point: these jobs are firing.
    const failingLine =
      failing.length === 0
        ? ""
        : `Running but FAILING every run: ${failDetail}${failing.length > 8 ? " …" : ""}. These fire on schedule, so the silence check cannot see them. `;
    const body = `${silentLine}${failingLine}Check /system/health.`;

    // Out-of-band alert on BOTH surfaces. recordCoachEvent never throws;
    // sendTelegram no-ops if BOT_TOKEN is unset. Wrapped in a step so a
    // function retry doesn't re-fire the Telegram. Returning success is
    // correct — the watchdog DID its job; the silent crons are the alert
    // payload, not a failure of the watchdog itself.
    await step.run("alert", async () => {
      await recordCoachEvent({
        kind: "system-alert",
        subjectId: "cron-heartbeat",
        priority: "P0",
        title,
        body,
        deepLink: "/system/health",
        surfaces: ["scoreboard", "brain"],
        expiresAt: new Date(now + 25 * HOUR_MS).toISOString(),
      });
      await sendTelegram(formatTelegramNotification(title, body, "high"));
      return true;
    });

    log.warn("heartbeat_silent", {
      silent: silent.length,
      failing: failing.length,
      detail,
      failDetail,
      newborn,
    });
    return {
      checked: expected.length,
      silent: silent.length,
      failing: failing.length,
      newborn: newborn.length,
    };
  },
);
