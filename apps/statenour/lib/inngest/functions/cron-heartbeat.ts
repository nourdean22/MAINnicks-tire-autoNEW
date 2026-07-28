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
        .catch(() => {});
      return true;
    });

    const expected = expectedJobs();
    const names = expected.map((e) => e.name);

    // Return serializable numbers (not Date objects) so the Inngest step
    // checkpoint survives JSON round-trip on retry.
    const lastRuns = await step.run("read-cronjoblog", async () => {
      const rows = await prisma.cronJobLog.groupBy({
        by: ["jobName"],
        where: { jobName: { in: names } },
        _max: { createdAt: true },
      });
      return rows.map((r) => ({
        name: r.jobName,
        lastMs: r._max.createdAt?.getTime() ?? null,
      }));
    });
    const lastByName = new Map(lastRuns.map((r) => [r.name, r.lastMs]));

    const now = Date.now();
    const silent = expected
      .map((e) => {
        const last = lastByName.get(e.name) ?? null;
        const ageH = last == null ? Infinity : (now - last) / HOUR_MS;
        return { name: e.name, ageH, maxAgeH: e.maxAgeH };
      })
      .filter((j) => j.ageH > j.maxAgeH);

    if (silent.length === 0) {
      log.info("heartbeat_ok", { checked: expected.length });
      return { checked: expected.length, silent: 0 };
    }

    const detail = silent
      .slice(0, 8)
      .map((j) => `${j.name} (${j.ageH === Infinity ? "never" : Math.round(j.ageH) + "h"})`)
      .join(", ");
    const title = `${silent.length} cron${silent.length > 1 ? "s" : ""} not firing`;
    const body = `Expected crons with no recent run: ${detail}${
      silent.length > 8 ? " …" : ""
    }. The mega fan-out may be broken — check /system/health.`;

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

    log.warn("heartbeat_silent", { silent: silent.length, detail });
    return { checked: expected.length, silent: silent.length };
  },
);
