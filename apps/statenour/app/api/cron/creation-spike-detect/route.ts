/**
 * /api/cron/creation-spike-detect · v8.10 BATCH 59 · Apr 29.
 *
 * Folded into mega-evening. Daily scan of entity_audits for
 * unusually high create rates per entity-type vs trailing 7d
 * median.
 */

import { cronHandler } from "@/lib/utils/http";
import { runCreationSpikeDetect } from "@/lib/db/creation-spike-detector";
import { recordCoachEvent } from "@/lib/services/coach-events";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runCreationSpikeDetect();

    // Mastery Layer Stage A · 8th writer migration · dual-write to coach
    // channel when actual spike alerts fired (not just detected · the
    // detector has its own dedup via alertsWritten). Surfaces on
    // /scoreboard + NickSidePane chips. subjectId = ISO date so dedup
    // is one-per-day. P1 since unusual create rates usually mean an
    // upstream pipeline issue · worth attention but not bleeding.
    // Best-effort.
    if (report.alertsWritten > 0) {
      const dayKey = report.ranAt.slice(0, 10);
      const top = report.details
        .filter((d) => d.alerted)
        .sort((a, b) => b.ratio - a.ratio)[0];
      try {
        await recordCoachEvent({
          kind: "anomaly",
          subjectId: `creation-spike:${dayKey}`,
          priority: "P1",
          title: top
            ? `Creation spike · ${top.entityType} · ${top.lastHourCount} in last hour (${top.ratio.toFixed(1)}× median)`
            : `Creation spike · ${report.alertsWritten} alert${report.alertsWritten === 1 ? "" : "s"} fired`,
          body: `${report.spikesFound} spike${
            report.spikesFound === 1 ? "" : "s"
          } found across ${report.scannedTypes} entity types · ${report.alertsWritten} fresh alert${
            report.alertsWritten === 1 ? "" : "s"
          } written`,
          deepLink: "/system/alerts",
          surfaces: ["scoreboard"],
          extra: {
            date: dayKey,
            ranAt: report.ranAt,
            scannedTypes: report.scannedTypes,
            spikesFound: report.spikesFound,
            alertsWritten: report.alertsWritten,
            topSpike: top ?? null,
          },
        });
      } catch {
        /* best-effort */
      }
    }

    return { ok: true, durationMs: Date.now() - started, ...report };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "creation-spike-detect failed",
    };
  }
});
