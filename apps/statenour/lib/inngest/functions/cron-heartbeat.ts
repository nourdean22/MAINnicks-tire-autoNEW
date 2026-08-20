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
export function classifySilence(
  expected: ReadonlyArray<{ name: string; maxAgeH: number }>,
  lastMsByName: ReadonlyMap<string, number | null>,
  firstSeenMsByName: ReadonlyMap<string, number>,
  nowMs: number,
): SilenceVerdict {
  const silent: SilentJob[] = [];
  const newborn: string[] = [];
  for (const e of expected) {
    const last = lastMsByName.get(e.name) ?? null;
    if (last != null) {
      const ageH = (nowMs - last) / HOUR_MS;
      if (ageH > e.maxAgeH) silent.push({ name: e.name, ageH, maxAgeH: e.maxAgeH });
      continue;
    }
    const firstSeen = firstSeenMsByName.get(e.name);
    if (firstSeen === undefined || (nowMs - firstSeen) / HOUR_MS <= e.maxAgeH) {
      newborn.push(e.name);
      continue;
    }
    silent.push({ name: e.name, ageH: Infinity, maxAgeH: e.maxAgeH });
  }
  return { silent, newborn };
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

    // Birth registry for the never-ran (see classifySilence). Reads existing
    // first-seen rows, then registers any expected job not yet on record.
    // Failure here degrades to the old behavior (no grace, page) — the
    // watchdog must fail toward alerting, never toward silence.
    const firstSeen = await step.run("first-seen-registry", async () => {
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
        logError("inngest.cron-heartbeat", e, { stage: "first-seen-registry", risk: "newborn grace unavailable; may false-page a new cron" }, "warn");
      }
      return out;
    });

    const now = Date.now();
    const { silent, newborn } = classifySilence(
      expected,
      lastByName,
      new Map(Object.entries(firstSeen)),
      now,
    );

    if (silent.length === 0) {
      log.info("heartbeat_ok", { checked: expected.length, newborn });
      return { checked: expected.length, silent: 0, newborn: newborn.length };
    }

    const detail = silent
      .slice(0, 8)
      .map((j) => `${j.name} (${j.ageH === Infinity ? "never" : Math.round(j.ageH) + "h"})`)
      .join(", ");
    const title = `${silent.length} cron${silent.length > 1 ? "s" : ""} not firing`;
    // 2026-08-20 · "The mega fan-out may be broken" fired on a morning the
    // fan-out had run CLEAN three hours earlier. One silent job usually means
    // that job; only a cluster implicates the fan-out itself.
    const body = `Expected crons with no recent run: ${detail}${
      silent.length > 8 ? " …" : ""
    }. ${silent.length > 1 ? "Several silent together — the mega fan-out itself may be down. " : ""}Check /system/health.`;

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

    log.warn("heartbeat_silent", { silent: silent.length, detail, newborn });
    return { checked: expected.length, silent: silent.length, newborn: newborn.length };
  },
);
