/**
 * OS-snapshot drift detector · v10.0.526 · Arc A F5
 *
 * Compares today's SystemMetric row for each `os_snapshot.<metric>`
 * against the 7-day-prior average. Week-over-week — day-over-day is
 * too noisy (a single 200-LOC PR moves loc_total enough to false-
 * alarm). The 7-day baseline averages out spike days while still
 * catching real regressions.
 *
 * Severity tiers map to relative deltas vs the baseline. The
 * direction of "regression" depends on the metric:
 *   · `route_count`, `cron_count`, `tool_count`, `test_file_count`,
 *     `loc_total` (and per-domain LOC) — DOWN is regression (capability
 *     loss). UP is growth.
 *   · `monster_file_count`, `any_usage_count`, `console_call_count` —
 *     UP is regression (debt growth). DOWN is improvement.
 *
 * Telegram alerting is idempotent — a BrainMemory(category="os_drift_alert",
 * key=YYYY-MM-DD) row gates the push so cron retries can't double-fire.
 */
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { OS_SNAPSHOT_METRIC_NAMES } from "@/lib/observability/os-snapshot";

export type RegressionSeverity = "info" | "warn" | "critical";

export interface Regression {
  metric: string;
  /** today's value */
  today: number;
  /** 7-day-prior baseline */
  baseline: number;
  /** relative delta = (today - baseline) / baseline, signed */
  pctDelta: number;
  /** signed absolute delta */
  absDelta: number;
  /** direction interpreted against metric polarity */
  direction: "regressed" | "improved";
  severity: RegressionSeverity;
}

export interface DriftReport {
  date: string;
  regressions: Regression[];
  improvements: Regression[];
  /** Highest severity among regressions; "info" when none. */
  worst: RegressionSeverity;
  /** Metrics whose read FAILED — excluded from comparison, never "no
   *  regression" (2026-07-30 sweep). */
  metricsUnreadable: string[];
}

/**
 * Metrics where INCREASE is the bad direction (debt grows).
 * Everything else: DECREASE is the bad direction (capability shrinks).
 */
const DEBT_METRICS: ReadonlySet<string> = new Set([
  "os_snapshot.monster_file_count",
  "os_snapshot.any_usage_count",
  "os_snapshot.console_call_count",
]);

/**
 * Thresholds (relative delta) for severity. Tuned to avoid daily
 * noise: ≥5% is the floor (small refactors below this don't alert),
 * ≥15% is "look at this", ≥30% is "something broke".
 */
const SEVERITY_THRESHOLDS = {
  warn: 0.05,
  alert: 0.15,
  critical: 0.3,
};

/**
 * Pull every os_snapshot.* metric for the last 14 days and compute
 * the week-over-week comparison. Today's value = the most recent
 * sample. Baseline = average over the window (today - 14d, today - 7d).
 */
export async function compareToWeekAgo(now: Date = new Date()): Promise<DriftReport> {
  const dateIso = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60_000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);

  const regressions: Regression[] = [];
  const improvements: Regression[] = [];
  const metricsUnreadable: string[] = [];

  for (const metric of OS_SNAPSHOT_METRIC_NAMES) {
    const rows = await prisma.systemMetric
      .findMany({
        where: {
          metric,
          createdAt: { gte: fourteenDaysAgo },
        },
        select: { value: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
      .catch((): { value: number; createdAt: Date }[] | null => null);

    if (rows === null) {
      // A failed read silently shrank the comparison set — the dropped
      // metric rendered as "no regression" (2026-07-30 sweep).
      metricsUnreadable.push(metric);
      continue;
    }
    if (rows.length === 0) continue;
    const today = rows[0]?.value;
    if (today === undefined) continue;

    // Baseline window: samples between 14d-ago and 7d-ago.
    const baselineSamples = rows
      .filter((r) => r.createdAt < sevenDaysAgo && r.createdAt >= fourteenDaysAgo)
      .map((r) => r.value);
    if (baselineSamples.length === 0) continue;

    const baseline =
      baselineSamples.reduce((a, b) => a + b, 0) / baselineSamples.length;
    if (baseline === 0) {
      // Avoid divide-by-zero — treat as "improvement from 0" only when
      // today is also 0 (no signal), otherwise skip.
      if (today === 0) continue;
      // We can't compute a relative delta; record as info-tier movement.
      const reg: Regression = {
        metric,
        today,
        baseline,
        pctDelta: Infinity,
        absDelta: today,
        direction: DEBT_METRICS.has(metric) ? "regressed" : "improved",
        severity: "info",
      };
      (reg.direction === "regressed" ? regressions : improvements).push(reg);
      continue;
    }

    const absDelta = today - baseline;
    const pctDelta = absDelta / baseline;
    const isDebt = DEBT_METRICS.has(metric);
    // For debt metrics, +delta is bad; for capability metrics, -delta is bad.
    const isRegressed = isDebt ? pctDelta > 0 : pctDelta < 0;
    const magnitude = Math.abs(pctDelta);
    if (magnitude < SEVERITY_THRESHOLDS.warn) continue;

    const severity: RegressionSeverity =
      magnitude >= SEVERITY_THRESHOLDS.critical
        ? "critical"
        : magnitude >= SEVERITY_THRESHOLDS.alert
        ? "warn"
        : "info";

    const reg: Regression = {
      metric,
      today,
      baseline,
      pctDelta,
      absDelta,
      direction: isRegressed ? "regressed" : "improved",
      severity,
    };
    (isRegressed ? regressions : improvements).push(reg);
  }

  // Sort regressions worst-first so the operator sees critical first.
  const severityRank: Record<RegressionSeverity, number> = { critical: 2, warn: 1, info: 0 };
  regressions.sort((a, b) => {
    const sevDiff = severityRank[b.severity] - severityRank[a.severity];
    if (sevDiff !== 0) return sevDiff;
    return Math.abs(b.pctDelta) - Math.abs(a.pctDelta);
  });

  const worst: RegressionSeverity =
    regressions[0]?.severity ?? "info";

  return { date: dateIso, regressions, improvements, worst, metricsUnreadable };
}

/**
 * Compose a tight Telegram message from a drift report. Returns null
 * if nothing is worth pushing (no warn+ regressions).
 *
 * The composer is exported so tests can assert on it without firing
 * a network request.
 */
export function composeDriftAlert(report: DriftReport): string | null {
  // Only push when we have warn or critical regressions. info-tier
  // movement is logged but not phone-pinged.
  const noisy = report.regressions.filter(
    (r) => r.severity === "warn" || r.severity === "critical",
  );
  if (noisy.length === 0) return null;

  const icon =
    report.worst === "critical" ? "🔴" : report.worst === "warn" ? "🟡" : "🟢";
  const lines: string[] = [];
  lines.push(`${icon} <b>OS-drift · ${report.date}</b>`);
  lines.push(`<i>${noisy.length} metric${noisy.length === 1 ? "" : "s"} regressed vs 7d baseline</i>`);
  for (const r of noisy.slice(0, 8)) {
    const sign = r.pctDelta > 0 ? "+" : "";
    const pct = (r.pctDelta * 100).toFixed(1);
    const short = r.metric.replace("os_snapshot.", "");
    lines.push(
      `· ${escapeHtml(short)}: ${r.baseline.toFixed(0)} → ${r.today.toFixed(0)} (${sign}${pct}%)`,
    );
  }
  if (noisy.length > 8) {
    lines.push(`<i>… and ${noisy.length - 8} more</i>`);
  }
  return lines.join("\n");
}

/**
 * Send the alert exactly once per day. Idempotency lives in a
 * BrainMemory(category="os_drift_alert", key=YYYY-MM-DD) marker row.
 *
 * Returns true on actual push, false on skip (already pushed today, no
 * regressions worth pushing, or Telegram failure).
 */
export async function pushDriftAlertIfNeeded(
  report: DriftReport,
): Promise<{ pushed: boolean; reason: string }> {
  const text = composeDriftAlert(report);
  if (!text) {
    return { pushed: false, reason: "no_warn_or_critical_regressions" };
  }

  const existing = await prisma.brainMemory
    .findFirst({
      where: { category: "os_drift_alert", key: report.date },
      select: { id: true },
    })
    .catch(() => null);
  if (existing) {
    return { pushed: false, reason: "already_pushed_today" };
  }

  let telegramOk = false;
  try {
    telegramOk = await sendTelegram(text, undefined, "HTML");
  } catch {
    telegramOk = false;
  }

  await prisma.brainMemory
    .create({
      data: {
        category: "os_drift_alert",
        key: report.date,
        content: text,
        confidence: 0.9,
        source: "cron:os-snapshot",
        metadata: {
          worst: report.worst,
          regressionCount: report.regressions.length,
          improvementCount: report.improvements.length,
          telegramOk,
        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    })
    .catch(() => undefined);

  return {
    pushed: telegramOk,
    reason: telegramOk ? "alert_sent" : "telegram_unavailable",
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
