/**
 * GET /api/cron/inngest-liveness · 2026-07-28 cron-truth hardening.
 *
 * THE OUT-OF-BAND ANSWER TO "who watches the watcher": cron-heartbeat
 * (the fan-out watchdog) is itself an Inngest-scheduled function — so
 * when Inngest Cloud's manifest drifted and stopped invoking the whole
 * scheduled fleet (docs/audits/2026-07-28-cron-truth.md, Finding 1),
 * the watchdog died WITH the thing it watched and nothing screamed.
 *
 * This route runs from the WORKER's node-cron (a different service on
 * a different scheduler — alive even when every Inngest function is
 * dead). It reads the heartbeat's self-row age from cron_job_logs:
 * older than 26h (or absent) means Inngest is not invoking scheduled
 * functions → P0 Telegram with the re-sync runbook.
 *
 * cronHandler provides cron auth + its own CronJobLog persistence.
 */
import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram, formatTelegramNotification } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/inngest-liveness");

const HOUR_MS = 3_600_000;
/** Heartbeat fires daily 12:00 UTC; 26h = one missed cycle + grace. */
const MAX_AGE_H = 26;

export const GET = cronHandler(async () => {
  const newest = await prisma.cronJobLog.findFirst({
    where: { jobName: "cron-heartbeat", status: "success" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const ageH = newest
    ? (Date.now() - newest.createdAt.getTime()) / HOUR_MS
    : Infinity;

  if (ageH <= MAX_AGE_H) {
    log.info("inngest_alive", { heartbeatAgeH: Math.round(ageH * 10) / 10 });
    return { ok: true, heartbeatAgeH: Math.round(ageH * 10) / 10 };
  }

  // Stale or absent → the Inngest scheduler is not invoking functions.
  // "Absent" is a true alarm too: it means proof-of-life has never been
  // written since this mechanism deployed — exactly the 2026-07-28
  // blind spot this route exists to end.
  const ageLabel = newest ? `${Math.round(ageH)}h old` : "NEVER written";
  const title = "Inngest scheduler appears DOWN";
  const body =
    `cron-heartbeat's proof-of-life row is ${ageLabel} (max ${MAX_AGE_H}h). ` +
    `The Inngest-scheduled fleet (briefs, pushes, sweeper, watchdog) is likely not firing. ` +
    `Runbook: curl -X PUT https://bdnick.info/api/inngest (re-sync), then verify ` +
    `briefing_log gains a row after the next 10:15 UTC. ` +
    `History: docs/audits/2026-07-28-cron-truth.md.`;
  await sendTelegram(formatTelegramNotification(title, body, "high"));
  log.warn("inngest_stale", { heartbeatAge: ageLabel });
  return { ok: false, heartbeatAge: ageLabel, alerted: true };
});
