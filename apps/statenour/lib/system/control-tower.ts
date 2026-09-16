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

export interface TowerDiagnostics {
  db: { connected: boolean; latency_ms: number };
  kpis: {
    latency_24h: { avg_ms: number; p95_ms: number };
    errors_24h: number;
    requests_24h: number;
  };
  devices?: { online: number; offline: number; error: number; total: number };
  integrations?: { name: string; status: string; enabled: boolean }[];
}

export interface TowerHealth {
  status?: string;
  alerts?: { unresolved: number };
}

export interface TowerInput {
  diagnostics: TowerDiagnostics | null;
  health: TowerHealth | null;
  /** The diagnostics query is in an error state (first load or a later refresh). */
  diagnosticsReadFailed: boolean;
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
              href: "/system/health",
            },
          ],
        }
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
    exceptions.push({ key: "db", line: "database unreachable", tone: "rose", href: "/system/health" });
  }
  if (d.kpis.errors_24h > 0) {
    exceptions.push({
      key: "errors",
      line: `${plural(d.kpis.errors_24h, "error", "errors")} in the last 24h`,
      tone: d.kpis.errors_24h >= 10 ? "rose" : "amber",
      href: "/system/logs",
    });
  }
  const unresolved = input.health?.alerts?.unresolved ?? 0;
  if (unresolved > 0) {
    exceptions.push({
      key: "alerts",
      line: `${plural(unresolved, "unresolved alert", "unresolved alerts")}`,
      tone: "amber",
      href: "/system/alerts",
    });
  }
  const devError = d.devices?.error ?? 0;
  if (devError > 0) {
    exceptions.push({
      key: "devices-error",
      line: `${plural(devError, "device", "devices")} in error`,
      tone: "rose",
      href: "/system/fleet",
    });
  }
  const devOffline = d.devices?.offline ?? 0;
  if (devOffline > 0) {
    exceptions.push({
      key: "devices-offline",
      line: `${plural(devOffline, "device", "devices")} offline`,
      tone: "amber",
      href: "/system/fleet",
    });
  }
  for (const i of d.integrations ?? []) {
    if (i.enabled && UNHEALTHY_INTEGRATION.test(i.status)) {
      exceptions.push({
        key: `integration-${i.name}`,
        line: `${i.name} integration ${i.status.toLowerCase()}`,
        tone: "amber",
        href: "/system/health",
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
