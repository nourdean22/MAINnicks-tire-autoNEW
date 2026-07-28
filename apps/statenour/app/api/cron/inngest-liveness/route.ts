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

/**
 * Spine-7 · capability artifacts. The heartbeat row proves Inngest
 * INVOKED one function and that function could write one row — it says
 * nothing about whether the capabilities PRODUCED. Each critical loop
 * gets its expected artifact checked here, out-of-band, on the worker's
 * scheduler. Artifacts are the loop's own output tables — no new
 * bookkeeping to trust, no new bookkeeping to rot.
 */
const CAPABILITY_ARTIFACTS: Array<{
  capability: string;
  maxAgeH: number;
  probe: () => Promise<Date | null>;
}> = [
  {
    // Daily brief composes at 10:15 UTC — the artifact IS the brief row.
    capability: "daily-brief",
    maxAgeH: 30,
    probe: async () => {
      const r = await prisma.briefingLog.findFirst({
        where: { briefType: "daily" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      return r?.createdAt ?? null;
    },
  },
  {
    // Outbox drain runs nightly via mega-evening; its CronJobLog row is
    // the artifact (cronHandler persists it on every real run).
    capability: "outbox-drain",
    maxAgeH: 30,
    probe: async () => {
      const r = await prisma.cronJobLog.findFirst({
        where: { jobName: "outbox-drain" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      return r?.createdAt ?? null;
    },
  },
];

export const GET = cronHandler(async () => {
  const newest = await prisma.cronJobLog.findFirst({
    where: { jobName: "cron-heartbeat", status: "success" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const ageH = newest
    ? (Date.now() - newest.createdAt.getTime()) / HOUR_MS
    : Infinity;

  // Capability artifacts — checked on EVERY run, independent of the
  // heartbeat verdict. Distinguish never-produced from stale from fresh;
  // a probe failure reports unknown, never healthy.
  const artifacts: Array<{ capability: string; state: string; ageH: number | null }> = [];
  for (const a of CAPABILITY_ARTIFACTS) {
    try {
      const at = await a.probe();
      if (!at) {
        artifacts.push({ capability: a.capability, state: "never_produced", ageH: null });
      } else {
        const h = (Date.now() - at.getTime()) / HOUR_MS;
        artifacts.push({
          capability: a.capability,
          state: h <= a.maxAgeH ? "fresh" : "stale",
          ageH: Math.round(h * 10) / 10,
        });
      }
    } catch (e) {
      log.warn("artifact_probe_failed", {
        capability: a.capability,
        error: e instanceof Error ? e.message : String(e),
      });
      artifacts.push({ capability: a.capability, state: "unknown", ageH: null });
    }
  }
  const missing = artifacts.filter((a) => a.state === "stale" || a.state === "never_produced");

  if (ageH <= MAX_AGE_H) {
    if (missing.length > 0) {
      // Inngest is invoking functions, but a capability's OUTPUT is
      // missing — the exact gap invocation-proof cannot see.
      const lines = missing
        .map((m) => `${m.capability}: ${m.state}${m.ageH != null ? ` (${Math.round(m.ageH)}h)` : ""}`)
        .join(" · ");
      await sendTelegram(
        formatTelegramNotification(
          "Scheduled capability missing its artifact",
          `Inngest heartbeat is fresh, but: ${lines}. The scheduler is alive and the capability still isn't producing — check the function's own logs.`,
          "high",
        ),
      );
      log.warn("capability_artifact_missing", { missing });
      return { ok: false, heartbeatAgeH: Math.round(ageH * 10) / 10, artifacts, alerted: true };
    }
    log.info("inngest_alive", { heartbeatAgeH: Math.round(ageH * 10) / 10, artifacts });
    return { ok: true, heartbeatAgeH: Math.round(ageH * 10) / 10, artifacts };
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
  return { ok: false, heartbeatAge: ageLabel, artifacts, alerted: true };
});
