/**
 * Cron diagnostics core — shared by:
 *   · /api/system/cron-diagnostics  (web endpoint · owner-auth)
 *   · scripts/cron-diagnostics-local.ts (local tsx probe)
 *
 * Pre-v11.2 the route + script each hand-duplicated ~200 LOC of
 * identical analysis logic. Any fix to one had to be remembered +
 * mirrored. Now both wrap this single module.
 *
 * What this gives you:
 *   · scanCronHealth() — runs every check in parallel, returns a
 *     prioritized report with diagnoses (critical first), per-job
 *     summaries, silent-cron list, and kill-switch list
 *
 * No network I/O. Only DB + env reads. Safe to run anywhere with a
 * configured Prisma client.
 */

import { prisma } from "@/lib/prisma";
import { CRONS } from "@/config/crons";
import { getPowerSettings } from "@/lib/services/power-panel";
import { listCronControls, isHardFailure, HARD_FAILURE_STATUSES } from "@/lib/services/cron-control";
import { isGoogleOauthConfigured } from "@/lib/services/google-oauth";

/**
 * Compute the max expected gap (in hours) between consecutive fires
 * of a 5-field cron expression. Used to derive a cadence-aware
 * silence threshold so a once-a-week cron isn't flagged "silent" 48h
 * after it last fired — that's still on schedule.
 *
 * Pre-fix: silent was binary "no log in last 48h". 5 of 6 false
 * positives on /system/health on 2026-05-01 were weekly Sun crons
 * that hadn't yet hit their next Sunday. Now we use 1.5x the natural
 * gap (with a 48h floor) so weekly crons get ~10.5d of slack.
 *
 * Returns 24h fallback for any expression we can't parse — same as
 * the pre-fix behavior, no regression risk on parse failure.
 */
export function maxGapHoursFromCron(cron: string | null): number {
  if (!cron) return 24;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 24;
  const [minuteRaw, hourRaw, , , dowRaw] = parts;

  // Day-of-week specified → weekly cadence
  if (dowRaw && dowRaw !== "*") {
    if (dowRaw.includes(",")) {
      const days = dowRaw
        .split(",")
        .map((d) => parseInt(d.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 7)
        .map((n) => n % 7) // normalize 7→0
        .sort((a, b) => a - b);
      if (days.length === 0) return 7 * 24;
      let maxGap = 0;
      for (let i = 0; i < days.length; i++) {
        const next =
          i === days.length - 1 ? days[0] + 7 : days[i + 1];
        const gap = next - days[i];
        if (gap > maxGap) maxGap = gap;
      }
      return Math.max(1, maxGap) * 24;
    }
    return 7 * 24; // single day per week
  }

  // Hour field decides daily-or-finer cadence
  const hour = hourRaw ?? "*";
  if (hour.startsWith("*/")) {
    const n = parseInt(hour.slice(2), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  if (hour !== "*") {
    if (hour.includes(",")) {
      const hours = hour
        .split(",")
        .map((h) => parseInt(h.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 23)
        .sort((a, b) => a - b);
      if (hours.length === 0) return 24;
      let maxGap = 0;
      for (let i = 0; i < hours.length; i++) {
        const next = i === hours.length - 1 ? hours[0] + 24 : hours[i + 1];
        const gap = next - hours[i];
        if (gap > maxGap) maxGap = gap;
      }
      return Math.max(1, maxGap);
    }
    return 24; // single hour per day
  }

  // Hour is *. Minute decides.
  const minute = minuteRaw ?? "*";
  if (minute.startsWith("*/")) {
    const n = parseInt(minute.slice(2), 10);
    return Number.isFinite(n) && n > 0 ? n / 60 : 1;
  }
  // Minute is specific or *. Default 1h floor.
  return 1;
}

/**
 * Silence threshold for a given schedule — never lower than 48h,
 * and 1.5x the cron's natural gap above that. Weekly cron → ~10.5d.
 */
export function silentThresholdHoursFromCron(cron: string | null): number {
  const gap = maxGapHoursFromCron(cron);
  return Math.max(48, Math.ceil(gap * 1.5));
}

export type DiagnosisSeverity = "critical" | "warning" | "info";

export interface CronJobSummary {
  jobName: string;
  lastSuccessAt: string | null;
  lastFailAt: string | null;
  /** Most recent error message for this job (null when never failed). */
  lastError: string | null;
  success48h: number;
  fail48h: number;
}

export interface CronDiagnosis {
  severity: DiagnosisSeverity;
  headline: string;
  detail: string;
  fix: string;
}

export interface CronKilledCron {
  jobName: string;
  note: string | null;
  /** ISO-8601 string or null. listCronControls returns string | null
   *  (stored inside BrainMemory JSON content, not a real Date column). */
  updatedAt: string | null;
}

export interface CronHealthReport {
  checkedAt: string;
  summary: {
    declaredActiveCrons: number;
    jobsWithLogsLast48h: number;
    silentDeclaredCrons: number;
    killedIndividually: number;
    pauseAllCrons: boolean;
    cronSecretPresent: boolean;
    googleOauthConfigured: boolean;
    totalLogRowsLast48h: number;
  };
  diagnoses: CronDiagnosis[];
  jobSummaries: CronJobSummary[];
  silentDeclaredCrons: string[];
  killedIndividually: CronKilledCron[];
}

/**
 * Context passed to collectDiagnoses. Everything is pre-rolled-up so
 * the function stays pure — no DB / env reads, fully testable.
 */
export interface DiagnosisContext {
  cronSecretPresent: boolean;
  pauseAllCrons: boolean;
  killedIndividually: CronKilledCron[];
  googleOauth: boolean;
  declaredCount: number;
  silent: string[];
  totalLogRowsLast48h: number;
}

/**
 * Emit the prioritized diagnosis list from a rolled-up fact bag.
 * Extracted from scanCronHealth so branch coverage is unit-testable
 * without mocking Prisma — see tests/lib/cron-diagnostics.test.ts.
 *
 * Order matters: critical issues first so the UI can render them at
 * the top without re-sorting. A healthy system returns a single info
 * diagnosis so the response shape is never an empty array.
 */
export function collectDiagnoses(ctx: DiagnosisContext): CronDiagnosis[] {
  const diagnoses: CronDiagnosis[] = [];

  if (!ctx.cronSecretPresent) {
    diagnoses.push({
      severity: "critical",
      headline: "CRON_SECRET not configured",
      detail:
        "Every cron route uses requireCronAuth which expects Bearer <CRON_SECRET>. Without it, every cron call gets 401 — the job 'fires' but does nothing.",
      fix: "Set CRON_SECRET in the Railway service env. The Inngest fan-out and every cron route must share the same value.",
    });
  }

  if (ctx.pauseAllCrons) {
    diagnoses.push({
      severity: "critical",
      headline: "pauseAllCrons is TRUE — every cron is manually killed",
      detail:
        "The power-panel kill switch is flipped. Crons are scheduled but the kill switch (cronHandler for route crons, the Inngest lifecycle middleware for Inngest-native crons) skips every run.",
      fix: "Go to /system/power → toggle 'Pause all crons' off. Or POST /api/system/power with { key: 'pauseAllCrons', value: false }.",
    });
  }

  if (ctx.killedIndividually.length > 0) {
    diagnoses.push({
      severity: "warning",
      headline: `${ctx.killedIndividually.length} cron${ctx.killedIndividually.length === 1 ? "" : "s"} individually disabled`,
      detail: `Per-cron kill switches set: ${ctx.killedIndividually.map((c) => c.jobName).join(", ")}`,
      fix: "Re-enable from /system/crons (flip each green) · systemAutomation.setCronEnabled({ jobName, enabled: true }).",
    });
  }

  if (!ctx.googleOauth) {
    diagnoses.push({
      severity: "warning",
      headline:
        "Google OAuth not configured — ingest-drive, ingest-gmail, ingest-calendar silently skip",
      detail:
        "These three crons fire on schedule but return { skipped: true, reason: 'google_oauth_not_configured' } before writing any audit event. The Cold Memory card shows 'LAST SYNC: Xd ago' based on the last audit event, making it look like things are fine when they're actively broken.",
      fix: "Visit /api/oauth/google-data/start and re-grant Drive + Gmail + Calendar read access. Tokens may have expired.",
    });
  }

  if (ctx.declaredCount > 40) {
    diagnoses.push({
      severity: "warning",
      headline: `${ctx.declaredCount} active crons — heavy cron surface`,
      detail:
        "Railway has no platform cron cap, so nothing breaks at this count — but a large cron surface is more load and more failure points to keep healthy.",
      fix: "Fold related crons into the mega fan-out slots (config/crons.ts CronMode='folded') or consolidate overlapping work. `pnpm check:crons` ranks fold candidates.",
    });
  }

  if (ctx.silent.length > 0) {
    diagnoses.push({
      severity: "warning",
      headline: `${ctx.silent.length} declared crons have NOT logged in the last 48h`,
      detail: `These are scheduled but have zero CronJobLog rows under their manifest name. Either not firing at all OR firing and crashing before the log-write. Names: ${ctx.silent.slice(0, 10).join(", ")}${ctx.silent.length > 10 ? "…" : ""}`,
      fix: "Check the Inngest dashboard for each one. If Inngest shows a recent successful invocation but no local CronJobLog row, the failure is inside the cron handler — after auth passed, before the logger fired.",
    });
  }

  if (ctx.totalLogRowsLast48h === 0) {
    diagnoses.push({
      severity: "critical",
      headline: "ZERO CronJobLog rows in the last 48h",
      detail:
        "Something is preventing every cron from writing to the log. Either (a) no crons fired, (b) they fire but requireCronAuth fails silently, or (c) the DB quota is exhausted.",
      fix: "Check the Inngest dashboard for recent run attempts. Verify CRON_SECRET in the Railway env. Check /api/system/env-check for db_quota_exhausted flag.",
    });
  }

  if (diagnoses.length === 0) {
    diagnoses.push({
      severity: "info",
      headline: "No obvious cron issues detected",
      detail:
        "Every declared cron has logged activity recently, pauseAllCrons is off, Google OAuth is configured. Individual cron health may still be degraded — check /system/crons for per-cron success/fail rates.",
      fix: "If you're still seeing stale data, check that the CRON expression is correct for the job in question.",
    });
  }

  return diagnoses;
}

/**
 * Main entry. Run every check in parallel, roll up into a single
 * prioritized report. Every subquery is independently try/catch'd
 * via the library-level helpers they call — one broken subsystem
 * doesn't poison the whole report.
 */
export async function scanCronHealth(): Promise<CronHealthReport> {
  const since48h = new Date(Date.now() - 48 * 3600_000);

  // Cadence-aware silence: pull lastSuccessAt for each DECLARED cron
  // across ALL time (not just 48h) so weekly/biweekly crons that last
  // fired >48h ago can be checked against their natural gap before
  // being flagged silent. Bounded by the declared list so we don't
  // scan millions of unrelated rows.
  const declaredNames = CRONS.filter((c) => c.mode === "active").map(
    (c) => c.name,
  );

  const [
    powerSettings,
    controls,
    googleOauth,
    byNameStatus,
    latestFailError,
    lastSuccessByName,
    oldestLogAgg,
  ] = await Promise.all([
    getPowerSettings().catch(() => null),
    listCronControls().catch(
      () => [] as Awaited<ReturnType<typeof listCronControls>>,
    ),
    isGoogleOauthConfigured().catch(() => false),
    prisma.cronJobLog.groupBy({
      by: ["jobName", "status"],
      where: { createdAt: { gte: since48h } },
      _count: { id: true },
      _max: { createdAt: true },
    }),
    // Pull up to 30 most-recent failures overall so we have error
    // messages for ~10-15 distinct jobs. Bounded.
    prisma.cronJobLog.findMany({
      where: { createdAt: { gte: since48h }, status: { in: [...HARD_FAILURE_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { jobName: true, error: true, createdAt: true },
    }),
    // All-time last success per declared cron — drives cadence-aware
    // silence detection. groupBy on _max(createdAt) gives the freshest
    // success timestamp per job in a single query.
    prisma.cronJobLog
      .groupBy({
        by: ["jobName"],
        where: {
          jobName: { in: declaredNames },
          status: "success",
        },
        _max: { createdAt: true },
      })
      .catch(
        () =>
          [] as Array<{
            jobName: string;
            _max: { createdAt: Date | null };
          }>,
      ),
    // Oldest cron-log row anywhere — used as the "logging-has-been-on
    // since" floor for the never-fired grace window. A cron that was
    // declared 2 days ago but logging has been running for months
    // genuinely never fires; a cron declared yesterday that hasn't
    // hit its first scheduled time gets grace until 1.5x its cadence
    // elapses. Without this, brand-new weekly crons (e.g. v8.2's
    // decision-quality-drift) get false-flagged the day they ship.
    prisma.cronJobLog
      .aggregate({
        _min: { createdAt: true },
      })
      .catch(() => ({ _min: { createdAt: null as Date | null } })),
  ]);

  // Build per-job summary from the groupBy rollup
  const byJob: Record<string, CronJobSummary> = {};
  for (const r of byNameStatus) {
    const job = (byJob[r.jobName] ??= {
      jobName: r.jobName,
      lastSuccessAt: null,
      lastFailAt: null,
      lastError: null,
      success48h: 0,
      fail48h: 0,
    });
    if (r.status === "success") {
      job.success48h = r._count.id;
      job.lastSuccessAt = r._max.createdAt?.toISOString() ?? null;
    } else if (isHardFailure(r.status)) {
      // one groupBy row per hard-failure status - sum, and keep the newest failure time
      job.fail48h += r._count.id;
      const at = r._max.createdAt?.toISOString() ?? null;
      if (at && (!job.lastFailAt || at > job.lastFailAt)) job.lastFailAt = at;
    }
  }
  for (const r of latestFailError) {
    const job = byJob[r.jobName];
    if (job && !job.lastError) {
      job.lastError = r.error ? r.error.slice(0, 240) : null;
    }
  }
  const jobSummaries = Object.values(byJob).sort(
    (a, b) => b.success48h + b.fail48h - (a.success48h + a.fail48h),
  );

  // Exact match — post-2026-04-22 the jobName suffix fix makes the
  // old split("-")[0] fallback obsolete + a source of false negatives.
  const loggedNames = new Set(Object.keys(byJob));
  const declaredActive = CRONS.filter((c) => c.mode === "active");

  // Cadence-aware silence detection — was a flat 48h window, but
  // weekly + biweekly crons hadn't fired yet within that window even
  // though they were "on schedule". Now each cron is checked against
  // 1.5x its natural cadence (with a 48h floor). A Sunday-only cron
  // that fired last Sunday is NOT silent; a Sunday-only cron that's
  // been quiet for 11 days IS silent.
  const lastSuccessMap = new Map<string, Date | null>();
  for (const r of lastSuccessByName) {
    lastSuccessMap.set(r.jobName, r._max.createdAt);
  }
  const now = Date.now();
  const oldestLogAt = oldestLogAgg?._min?.createdAt
    ? oldestLogAgg._min.createdAt.getTime()
    : now; // fresh DB → no logs yet → treat "young" so nothing flags
  const silent = declaredActive
    .filter((c) => {
      // Job has logged in last 48h → definitely not silent.
      if (loggedNames.has(c.name)) return false;
      const thresholdHours = silentThresholdHoursFromCron(c.schedule);
      const last = lastSuccessMap.get(c.name);
      // Never logged → silent ONLY if the cron has had a real chance
      // to fire by now. "Real chance" = 1.5x its cadence has elapsed
      // since it was added to the manifest (when `addedAt` is set)
      // OR since logging started (when it isn't). New weekly crons
      // get ~10.5 days of grace measured from THEIR ship date so a
      // cron added Tuesday isn't flagged silent for missing the
      // previous Sunday it never had a chance to attend.
      if (!last) {
        const declaredAtMs = c.addedAt
          ? Date.parse(c.addedAt + "T00:00:00Z")
          : oldestLogAt;
        const referenceMs = Number.isFinite(declaredAtMs)
          ? Math.max(declaredAtMs, oldestLogAt)
          : oldestLogAt;
        const elapsedHours = (now - referenceMs) / 3_600_000;
        return elapsedHours > thresholdHours;
      }
      const ageHours = (now - last.getTime()) / 3_600_000;
      return ageHours > thresholdHours;
    })
    .map((c) => c.name);
  const totalLogRowsLast48h = Object.values(byJob).reduce(
    (sum, j) => sum + j.success48h + j.fail48h,
    0,
  );

  const killedIndividually: CronKilledCron[] = controls
    .filter((c) => !c.enabled)
    .map((c) => ({
      jobName: c.jobName,
      note: c.note ?? null,
      updatedAt: c.updatedAt,
    }));

  const cronSecretPresent = Boolean(
    process.env.CRON_SECRET && process.env.CRON_SECRET.trim().length > 0,
  );
  const declaredCount = declaredActive.length;

  // Build prioritized diagnoses. Delegated to collectDiagnoses so
  // branch coverage is unit-testable without mocking every dep.
  const diagnoses = collectDiagnoses({
    cronSecretPresent,
    pauseAllCrons: powerSettings?.pauseAllCrons ?? false,
    killedIndividually,
    googleOauth,
    declaredCount,
    silent,
    totalLogRowsLast48h,
  });

  return {
    checkedAt: new Date().toISOString(),
    summary: {
      declaredActiveCrons: declaredCount,
      jobsWithLogsLast48h: loggedNames.size,
      silentDeclaredCrons: silent.length,
      killedIndividually: killedIndividually.length,
      pauseAllCrons: powerSettings?.pauseAllCrons ?? false,
      cronSecretPresent,
      googleOauthConfigured: googleOauth,
      totalLogRowsLast48h,
    },
    diagnoses,
    jobSummaries,
    silentDeclaredCrons: silent,
    killedIndividually,
  };
}
