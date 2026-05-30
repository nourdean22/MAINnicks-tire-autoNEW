/**
 * /api/cron/correlation-alarm · v8.2 · F2 · Apr 29.
 *
 * Runs every 6h. Finds cross-domain correlations across Nour's life
 * data (scores, jobs, habits, tasks, leads, commitments, chat
 * activity) and emits a BrainMemory alert when a NEW strong
 * correlation crosses |r|>0.7 vs. the last snapshot.
 *
 * Idempotency: each alert mints a key from {pair, direction,
 * rounded-r} so a flapping correlation doesn't re-fire alerts.
 *
 * Wired in config/crons.ts (v8.2 batch).
 */

import { cronHandler } from "@/lib/utils/http";
import { runCorrelationAlarm } from "@/lib/brain/correlation-alarm";
import { recordCoachEvent } from "@/lib/services/coach-events";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runCorrelationAlarm();

    // Mastery Layer Stage A · 7th writer migration · dual-write to coach
    // channel when new strong correlations are discovered. Surfaces on
    // /scoreboard + NickSidePane chips. subjectId = snapshot key so
    // dedup is one-per-run (the runner already dedups against the prior
    // snapshot · this just mirrors that into the coach channel). P1
    // since correlations are interesting but rarely urgent · the
    // operator reviews them on their own cadence. Best-effort.
    if (report.newAlerts.length > 0 && report.snapshotKey) {
      const top = report.newAlerts[0];
      const others = report.newAlerts.length - 1;
      try {
        await recordCoachEvent({
          kind: "anomaly",
          subjectId: `correlation:${report.snapshotKey}`,
          priority: "P1",
          title: `New correlation · ${top.a} ↔ ${top.b} · r=${top.coefficient.toFixed(2)} (${top.direction})${
            others > 0 ? ` · +${others} more` : ""
          }`,
          body: `${report.newAlerts.length} new strong correlation${
            report.newAlerts.length === 1 ? "" : "s"
          } crossed |r|>0.7 vs prior snapshot · ${report.strongCount} strong of ${report.totalCorrelations} total`,
          deepLink: "/system/alerts",
          surfaces: ["brain"],
          extra: {
            snapshotKey: report.snapshotKey,
            newAlertCount: report.newAlerts.length,
            strongCount: report.strongCount,
            totalCorrelations: report.totalCorrelations,
            suppressedCount: report.suppressedCount,
            topAlert: top,
          },
        });
      } catch {
        /* best-effort · coach event failures don't break the cron */
      }
    }

    return {
      ok: true,
      durationMs: Date.now() - started,
      ...report,
    };
  } catch (err) {
    // Re-throw so cronHandler → logCronRun records this run FAILED and
    // fires the cron.failure brain-bus event. Returning {ok:false}
    // RESOLVED the promise → logCronRun logged status:"success" (it never
    // inspects the returned .ok), so this detector showed GREEN on
    // /system/crons while silently dead.
    throw err instanceof Error ? err : new Error("correlation-alarm failed");
  }
});
