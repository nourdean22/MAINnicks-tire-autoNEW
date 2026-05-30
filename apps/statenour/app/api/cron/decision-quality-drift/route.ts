/**
 * /api/cron/decision-quality-drift · v8.2 · F3 · Apr 29.
 *
 * Weekly trend check on Nour's decision grades. Writes a BrainMemory
 * alert when this week's GPA dropped 15%+ vs the prior 4-week
 * baseline. Idempotent per week-ending-date.
 *
 * Cadence: weekly, Sunday 11:00 UTC (7am Cleveland Sunday morning so
 * Nour sees it with his weekly review).
 */

import { cronHandler } from "@/lib/utils/http";
import { runDecisionQualityDrift } from "@/lib/brain/decision-quality-drift";
import { recordCoachEvent } from "@/lib/services/coach-events";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runDecisionQualityDrift();

    // Mastery Layer Stage A · 9th writer migration · dual-write to coach
    // channel when decision-quality drift fires. Surfaces on /scoreboard
    // + NickSidePane chips. subjectId = weekEndingDate so dedup is
    // one-per-week (matches the runner's own per-week idempotency). P0
    // since operator decision quality dropping is severe · same tier as
    // cost-slo + eval-regression. Best-effort.
    if (report.drift && report.alertWritten) {
      try {
        const recent = report.recentGpa?.toFixed(2) ?? "—";
        const baseline = report.baselineGpa?.toFixed(2) ?? "—";
        const drop = report.deltaPct != null ? `${(report.deltaPct * 100).toFixed(0)}%` : "—";
        await recordCoachEvent({
          kind: "drift-recovery",
          subjectId: `decision-quality-drift:${report.weekEndingDate}`,
          priority: "P0",
          title: `Decision quality drift · GPA ${recent} vs ${baseline} baseline (−${drop})`,
          body: `Recent ${report.recentSampleSize} decision${
            report.recentSampleSize === 1 ? "" : "s"
          } averaging ${recent} · prior ${report.baselineSampleSize} averaged ${baseline} · review the week.`,
          deepLink: "/system/quality",
          surfaces: ["scoreboard"],
          extra: {
            weekEndingDate: report.weekEndingDate,
            recentGpa: report.recentGpa,
            baselineGpa: report.baselineGpa,
            deltaPct: report.deltaPct,
            trend: report.trend,
            recentSampleSize: report.recentSampleSize,
            baselineSampleSize: report.baselineSampleSize,
          },
        });
      } catch {
        /* best-effort */
      }
    }

    return { ok: true, durationMs: Date.now() - started, ...report };
  } catch (err) {
    // Re-throw so cronHandler → logCronRun records this run FAILED and
    // fires the cron.failure brain-bus event. Returning {ok:false}
    // RESOLVED the promise → logCronRun logged status:"success" (it never
    // inspects the returned .ok), so this P0 decision-quality detector
    // showed GREEN on /system/crons while silently dead.
    throw err instanceof Error
      ? err
      : new Error("decision-quality-drift failed");
  }
});
