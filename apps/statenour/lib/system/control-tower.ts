/**
 * lib/system/control-tower.ts · 2026-09-16 · W7 (System recomposition)
 *
 * /system opens with ONE verdict — "ALL SYSTEMS NOMINAL" or
 * "N REQUIRE ATTENTION" — and then lists only the exceptions. This is the
 * pure function behind that block: it reads the diagnostics + health reads
 * the page already holds and returns the headline plus the exception rows.
 *
 * Rules it encodes (each cost an incident before it was a rule):
 *   · unknown is never nominal — no measurement, or a failed first read,
 *     renders as UNKNOWN, not as a healthy system (2026-08-19 rule);
 *   · a failed REFRESH keeps the last read but is itself an exception;
 *   · every source counts once, in a fixed order, so the count in the
 *     headline is the number of rows below it.
 *
 * Canary: tests/lib/system/control-tower.test.ts.
 */

import { errorSeverity } from "@/lib/system/error-thresholds";

export interface TowerDiagnostics {
  db: { connected: boolean; latency_ms: number };
  kpis: {
    latency_24h: { avg_ms: number; p95_ms: number };
    /** All ErrorLog rows (error + warn): the raw KPI the page prints. */
    errors_24h: number;
    /** level='error' rows only: what the health verdict reads. Optional so an older payload still reads. */
    error_level_24h?: number;
    requests_24h: number;
  };
  /** notReporting = status UNKNOWN (never reported); optional so an older payload still reads. */
  devices?: { online: number; offline: number; error: number; notReporting?: number; total: number };
  integrations?: { name: string; status: string; enabled: boolean }[];
}

export interface TowerHealth {
  status?: string;
  /**
   * system.healthSummary's alerts read, a MetricResult (lib/services/system-pages.ts): only "ok", or a
   * "degraded" read that still carries a value, holds a count. Until 2026-10-26 this was typed as a bare
   * `{ unresolved }`, so `alerts.unresolved` was always undefined and the alerts line never showed.
   */
  alerts?: { status: "ok" | "degraded" | "unavailable"; value?: { unresolved: number; priority?: number } } | null;
  /**
   * buildSystemHealth's rollup: the sources (alerts, radar, morningBrief, autonomic, and "db" when down) whose
   * read was not ok. Until 2026-10-29 only the alerts read was checked, so an unavailable radar, morningBrief or
   * autonomic read still rendered ALL SYSTEMS NOMINAL.
   */
  degradedSources?: string[];
}

export interface TowerInput {
  diagnostics: TowerDiagnostics | null;
  health: TowerHealth | null;
  /** The diagnostics query is in an error state (first load or a later refresh). */
  diagnosticsReadFailed: boolean;
  /** The query is paused with nothing read (offline first load): not measuring, and not measured either. */
  diagnosticsPaused?: boolean;
  /** The health summary (unresolved alerts) query failed: its count is unknown, never 0. */
  healthReadFailed?: boolean;
}

export interface TowerException {
  key: string;
  line: string;
  tone: "rose" | "amber";
  href?: string;
}

export interface TowerVerdict {
  state: "unknown" | "nominal" | "attention";
  headline: string;
  exceptions: TowerException[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Integration statuses that mean the lane is not doing its job. */
const UNHEALTHY_INTEGRATION = /fail|error|degraded|offline|down/i;

export function controlTower(input: TowerInput): TowerVerdict {
  const d = input.diagnostics;
  if (!d) {
    return input.diagnosticsReadFailed
      ? {
          state: "unknown",
          headline: "STATE UNKNOWN",
          exceptions: [
            {
              key: "diagnostics",
              line: "diagnostics read failed — nothing on this page is a measurement",
              tone: "rose",
            },
          ],
        }
      : input.diagnosticsPaused
        ? { state: "unknown", headline: "NOT MEASURED", exceptions: [] }
        : { state: "unknown", headline: "MEASURING", exceptions: [] };
  }

  const exceptions: TowerException[] = [];
  if (input.diagnosticsReadFailed) {
    exceptions.push({
      key: "refresh",
      line: "latest refresh failed — showing the last successful read",
      tone: "amber",
    });
  }
  if (!d.db.connected) {
    exceptions.push({ key: "db", line: "database unreachable", tone: "rose" });
  }
  // level='error' rows against the threshold table Home reads too (2026-10-29 sync audit, finding 3).
  // An older payload without the level count falls back to all rows: it can over-warn, never under-warn.
  const errorRows = d.kpis.error_level_24h ?? d.kpis.errors_24h;
  const errorLevel = errorSeverity(errorRows);
  if (errorLevel !== "normal") {
    exceptions.push({
      key: "errors",
      line: `${plural(errorRows, "error", "errors")} in the last 24h, ${errorLevel === "critical" ? "well " : ""}above baseline`,
      tone: errorLevel === "critical" ? "rose" : "amber",
    });
  }
  // 2026-10-26 audit: a failed health query, or an alerts metric that came back unavailable, left
  // `unresolved` at 0 and the tower said ALL SYSTEMS NOMINAL. Health still loading (null, no error) adds nothing.
  const alertsMetric = input.health?.alerts;
  const alertsCount = alertsMetric && alertsMetric.status !== "unavailable" ? alertsMetric.value?.unresolved : undefined;
  if ((input.health != null || input.healthReadFailed) && alertsCount === undefined) {
    exceptions.push({
      key: "alerts-unknown",
      line: "alerts read failed: open alerts unknown",
      tone: "amber",
      href: "/system/alerts",
    });
  }
  // The same open count /system/alerts lists and the hub tile shows (countOpenAlerts).
  const unresolved = alertsCount ?? 0;
  const priority = alertsMetric?.value?.priority ?? 0;
  if (unresolved > 0) {
    exceptions.push({
      key: "alerts",
      line: `${plural(unresolved, "open alert", "open alerts")}${priority > 0 ? `, ${priority} priority` : ""}`,
      tone: priority > 0 ? "rose" : "amber",
      href: "/system/alerts",
    });
  }
  // alerts has its own row above; db is already an exception when diagnostics says it is down.
  const namedSources = input.health?.degradedSources ?? [];
  for (const source of namedSources) {
    if (source === "alerts" || (source === "db" && !d.db.connected)) continue;
    exceptions.push({ key: `health-${source}`, line: `${source} health read unavailable`, tone: "amber" });
  }
  // Degraded with no source named (older payload): still not nominal.
  if (input.health?.status === "degraded" && namedSources.length === 0) {
    exceptions.push({ key: "health-degraded", line: "health summary degraded", tone: "amber" });
  }
  const devError = d.devices?.error ?? 0;
  if (devError > 0) {
    exceptions.push({
      key: "devices-error",
      line: `${plural(devError, "device", "devices")} in error`,
      tone: "rose",
      // no href: no page shows device rows
    });
  }
  const devOffline = d.devices?.offline ?? 0;
  if (devOffline > 0) {
    exceptions.push({
      key: "devices-offline",
      line: `${plural(devOffline, "device", "devices")} offline`,
      tone: "amber",
    });
  }
  const devSilent = d.devices?.notReporting ?? 0;
  if (devSilent > 0) {
    exceptions.push({
      key: "devices-not-reporting",
      line: `${plural(devSilent, "device", "devices")} not reporting`,
      tone: "amber",
    });
  }
  for (const i of d.integrations ?? []) {
    if (i.enabled && UNHEALTHY_INTEGRATION.test(i.status)) {
      exceptions.push({
        key: `integration-${i.name}`,
        line: `${i.name} integration ${i.status.toLowerCase()}`,
        tone: "amber",
      });
    }
  }

  const n = exceptions.length;
  return {
    state: n === 0 ? "nominal" : "attention",
    headline: n === 0 ? "ALL SYSTEMS NOMINAL" : `${n} REQUIRE${n === 1 ? "S" : ""} ATTENTION`,
    exceptions,
  };
}
