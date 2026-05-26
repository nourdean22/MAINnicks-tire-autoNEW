/**
 * GET /api/cron/cost-anomaly · v10.0.91 · 2026-05-02.
 *
 * Hourly z-score check on today's AI cost vs 7-day baseline.
 * Folded into mega-evening because AI cost only really matters
 * end-of-day. Returns the report so cron-runs surface dashboards.
 */

import { cronHandler } from "@/lib/utils/http";
import { detectCostAnomaly } from "@/lib/system/cost-anomaly";
import { recordCoachEvent } from "@/lib/services/coach-events";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const report = await detectCostAnomaly();

  // Mastery Layer Stage A · dual-write to the coach channel when an
  // anomaly is detected. Surfaces on /scoreboard CoachEventBanner so
  // the operator sees cost spikes/troughs alongside other system
  // alerts. subjectId = ET date so dedup is one-per-day. P0 for spikes
  // (cost overrun risk) · P1 for troughs (interesting but not bleeding).
  if (report.status === "spike" || report.status === "trough") {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const dollars = (report.todayCents / 100).toFixed(2);
    const baselineDollars = (report.baselineMean / 100).toFixed(2);
    const z = report.zScore?.toFixed(1) ?? "?";
    await recordCoachEvent({
      kind: "anomaly",
      subjectId: `cost-anomaly:${today}`,
      priority: report.status === "spike" ? "P0" : "P1",
      title:
        report.status === "spike"
          ? `AI cost spike · $${dollars} today (z=${z} vs $${baselineDollars} avg)`
          : `AI cost trough · $${dollars} today (z=${z} vs $${baselineDollars} avg)`,
      body: `Today's AI cost is ${report.status === "spike" ? "above" : "below"} the 7-day baseline by ${z}σ. ${report.topByModel?.[0] ? `Top contributor: ${report.topByModel[0].model} ($${(report.topByModel[0].cents / 100).toFixed(2)}, ${report.topByModel[0].calls} calls).` : ""}`,
      deepLink: "/system/ai-cost",
      surfaces: ["scoreboard"],
      extra: {
        date: today,
        todayCents: report.todayCents,
        baselineMean: report.baselineMean,
        baselineStdDev: report.baselineStdDev,
        zScore: report.zScore,
        status: report.status,
      },
    });
  }

  return report;
});
