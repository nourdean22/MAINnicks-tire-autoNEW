/**
 * GET /api/cron/os-snapshot · v10.0.526 · Arc A F5
 *
 * Folded into mega-evening. Snapshots OS-level metrics and writes each
 * one to SystemMetric under `metric_name="os_snapshot.<metric>"`. No
 * new table — the no-duplicate-data rule says use what we already have.
 *
 * After persisting, runs the drift detector and pushes a Telegram
 * alert if any warn/critical regressions exist vs the 7-day baseline.
 * Idempotent per-day via BrainMemory(category="os_drift_alert").
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { snapshotAll, snapshotToMetricRows } from "@/lib/observability/os-snapshot";
import {
  compareToWeekAgo,
  pushDriftAlertIfNeeded,
} from "@/lib/observability/drift-detector";
import { recordCoachEvent } from "@/lib/services/coach-events";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const snap = await snapshotAll();
  const rows = snapshotToMetricRows(snap);

  // Write every metric. SystemMetric is append-only — one row per
  // metric per snapshot run. Errors are swallowed (recordMetric in
  // lib/services/metrics.ts uses the same pattern: telemetry must
  // never break the cron itself).
  await Promise.all(
    rows.map((row) =>
      prisma.systemMetric
        .create({
          data: {
            metric: row.metric,
            value: row.value,
            unit: "count",
            source: "cron:os-snapshot",
            tags: {
              capturedAt: snap.capturedAt,
            } as unknown as Parameters<typeof prisma.systemMetric.create>[0]["data"]["tags"],
          },
        })
        .catch(() => undefined),
    ),
  );

  // Drift comparison: today vs 7-day-prior average. Fires Telegram
  // when worst severity ≥ warn. Idempotent per-day.
  const report = await compareToWeekAgo();
  const pushResult = await pushDriftAlertIfNeeded(report);

  // Mastery Layer Stage A · dual-write to the coach channel when drift
  // is warn-or-worse. Surfaces on /scoreboard and /brain so the
  // operator can see code-quality regressions without depending on
  // Telegram. subjectId = ET date · dedup is one-per-day.
  if (report.worst === "warn" || report.worst === "critical") {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const topRegression = report.regressions[0];
    await recordCoachEvent({
      kind: "system-alert",
      subjectId: `os-drift:${today}`,
      priority: report.worst === "critical" ? "P0" : "P1",
      title: `OS drift · ${report.regressions.length} regression${report.regressions.length === 1 ? "" : "s"} vs 7d baseline`,
      body: topRegression
        ? `Worst: ${topRegression.metric} · ${topRegression.severity} · today ${topRegression.today.toFixed(1)} vs ${topRegression.baseline.toFixed(1)} avg (${topRegression.pctDelta > 0 ? "+" : ""}${(topRegression.pctDelta * 100).toFixed(0)}%)`
        : `Worst severity: ${report.worst}`,
      deepLink: "/system/health",
      surfaces: ["scoreboard", "brain"],
      extra: {
        date: today,
        worst: report.worst,
        regressionCount: report.regressions.length,
        improvementCount: report.improvements.length,
      },
    });
  }

  return {
    ok: true,
    snapshot: {
      routeCount: snap.routeCount,
      cronCount: snap.cronCount,
      toolCount: snap.toolCount,
      locTotal: snap.locTotal,
      testFileCount: snap.testFileCount,
      monsterFileCount: snap.monsterFileCount,
      anyUsageCount: snap.anyUsageCount,
      consoleCallCount: snap.consoleCallCount,
    },
    drift: {
      worst: report.worst,
      regressions: report.regressions.length,
      improvements: report.improvements.length,
    },
    alert: pushResult,
    capturedAt: snap.capturedAt,
  };
});
