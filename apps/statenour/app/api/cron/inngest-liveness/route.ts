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
import { statenourArtifacts } from "@/lib/observability/fleet-truth";
import { sendTelegram, formatTelegramNotification } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/inngest-liveness");

const HOUR_MS = 3_600_000;
/** Heartbeat fires daily 12:00 UTC; 26h = one missed cycle + grace. */
const MAX_AGE_H = 26;

export const GET = cronHandler(async () => {
  // NL-3: probes extracted to lib/observability/fleet-truth so this
  // worker-fired route and the operator's /api/system/fleet-truth read
  // the SAME artifact checks (single source, no drift). The heartbeat
  // is one of the probes; its age drives the scheduler-down verdict.
  const artifacts = await statenourArtifacts();
  const heartbeat = artifacts.find((a) => a.capability === "inngest-heartbeat");
  const ageH =
    heartbeat && heartbeat.ageH != null ? heartbeat.ageH : Infinity;
  const newest = heartbeat && heartbeat.state !== "never_produced" ? true : null;
  const missing = artifacts.filter(
    (a) => a.capability !== "inngest-heartbeat" && (a.state === "stale" || a.state === "never_produced"),
  );

  if (ageH <= MAX_AGE_H) {
    if (missing.length > 0) {
      // Inngest is invoking functions, but a capability's OUTPUT is
      // missing — the exact gap invocation-proof cannot see.
      const lines = missing
        .map((m) => `${m.capability}: ${m.state}${m.ageH != null ? ` (${Math.round(m.ageH)}h)` : ""}`)
        .join(" · ");
      // `alerted` must reflect DELIVERY. sendTelegram reports failure by
      // returning false (never throwing), so hardcoding `alerted: true`
      // recreated the very blind spot this watchdog exists to end — one
      // layer up. Same shape as cost-slo-check/route.ts:181.
      const alerted = await sendTelegram(
        formatTelegramNotification(
          "Scheduled capability missing its artifact",
          `Inngest heartbeat is fresh, but: ${lines}. The scheduler is alive and the capability still isn't producing — check the function's own logs.`,
          "high",
        ),
      );
      if (!alerted) log.error("liveness_alert_undelivered", { reason: "capability_artifact_missing" });
      log.warn("capability_artifact_missing", { missing });
      return { ok: false, heartbeatAgeH: Math.round(ageH * 10) / 10, artifacts, alerted };
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
  const alerted = await sendTelegram(formatTelegramNotification(title, body, "high"));
  if (!alerted) {
    // The scheduler is down AND the alarm about it did not reach anyone.
    log.error("liveness_alert_undelivered", { reason: "inngest_stale", heartbeatAge: ageLabel });
  }
  log.warn("inngest_stale", { heartbeatAge: ageLabel });
  return { ok: false, heartbeatAge: ageLabel, artifacts, alerted };
});
