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
 * older than MAX_AGE_H as of the 13:00 UTC slot (or absent) means Inngest
 * is not invoking scheduled functions → P0 Telegram with the re-sync runbook.
 *
 * cronHandler provides cron auth + its own CronJobLog persistence.
 */
import { cronHandler } from "@/lib/utils/http";
import { statenourArtifacts } from "@/lib/observability/fleet-truth";
import { sendTelegram, formatTelegramNotification } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/inngest-liveness");

const HOUR_MS = 3_600_000;
/**
 * Heartbeat fires daily 12:00 UTC and this route at 13:00 UTC (config/crons.ts),
 * so a healthy beat is ~1h old here. 2026-10-10: was 26h, which let a missed
 * beat (25h old) pass and delayed the first alarm to the NEXT day (~49h).
 */
const MAX_AGE_H = 6;
/** This route's scheduled hour (config/crons.ts inngest-liveness "0 13 * * *"). */
const SLOT_HOUR_UTC = 13;

/**
 * The allowed age, judged as of the scheduled 13:00 slot: a run at another hour
 * (the 03:00 healer re-fire, a manual run) adds the time since that slot, so a
 * healthy noon beat never reads stale just because the check ran late.
 */
function allowedAgeH(now: Date = new Date()): number {
  const sinceSlotH = ((now.getUTCHours() - SLOT_HOUR_UTC + 24) % 24) + now.getUTCMinutes() / 60;
  return MAX_AGE_H + sinceSlotH;
}

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
  // 2026-10-10 · a probe that THREW is `unknown` (fleet-truth): never healthy,
  // and before this it was silently dropped from both checks.
  const unreadable = artifacts.filter((a) => a.capability !== "inngest-heartbeat" && a.state === "unknown");

  if (heartbeat?.state === "unknown") {
    // The heartbeat read failed: the scheduler's state is unknown, not "down".
    const alerted = await sendTelegram(
      formatTelegramNotification(
        "Inngest liveness UNKNOWN",
        "The cron-heartbeat probe failed (error_logs: artifact_probe_failed), so whether the Inngest scheduler is firing is unknown — not healthy, not confirmed down.",
        "medium",
      ),
    );
    if (!alerted) log.error("liveness_alert_undelivered", { reason: "heartbeat_probe_failed" });
    log.warn("heartbeat_probe_failed", { artifacts });
    return { ok: false, heartbeat: "unknown", artifacts, alerted };
  }

  const maxAgeH = allowedAgeH();
  if (ageH <= maxAgeH) {
    if (missing.length > 0 || unreadable.length > 0) {
      // Inngest is invoking functions, but a capability's OUTPUT is
      // missing (or could not be read) — the gap invocation-proof cannot see.
      const lines = [...missing, ...unreadable]
        .map((m) => `${m.capability}: ${m.state}${m.ageH != null ? ` (${Math.round(m.ageH)}h)` : ""}`)
        .join(" · ");
      // `alerted` must reflect DELIVERY. sendTelegram reports failure by
      // returning false (never throwing), so hardcoding `alerted: true`
      // recreated the very blind spot this watchdog exists to end — one
      // layer up. Same shape as cost-slo-check/route.ts:181.
      const alerted = await sendTelegram(
        missing.length > 0
          ? formatTelegramNotification(
              "Scheduled capability missing its artifact",
              `Inngest heartbeat is fresh, but: ${lines}. The scheduler is alive and the capability still isn't producing — check the function's own logs.`,
              "high",
            )
          : formatTelegramNotification(
              "Scheduled capability probe failed",
              `Inngest heartbeat is fresh, but: ${lines}. The probe threw, so these are unknown, not healthy — check error_logs (artifact_probe_failed).`,
              "medium",
            ),
      );
      if (!alerted) log.error("liveness_alert_undelivered", { reason: "capability_artifact_missing" });
      log.warn("capability_artifact_missing", { missing, unreadable });
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
    `cron-heartbeat's proof-of-life row is ${ageLabel} (max ${Math.round(maxAgeH)}h). ` +
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
