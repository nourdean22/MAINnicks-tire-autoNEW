/**
 * Integration Logger — In-memory event log for vendor integration activity.
 *
 * Tracks health checks, API calls, failures, and recovery events.
 * Keeps the last 500 events in memory for admin dashboard display.
 * Does NOT require a database migration.
 */

export type IntegrationEventType =
  | "health_check"
  | "auth_success"
  | "auth_failure"
  | "api_call"
  | "api_error"
  | "timeout"
  | "fallback_activated"
  | "recovery"
  | "smoke_test";

export interface IntegrationEvent {
  id: string;
  vendor: string;
  type: IntegrationEventType;
  message: string;
  latencyMs?: number;
  error?: string;
  timestamp: string;
}

const MAX_EVENTS = 500;
const eventLog: IntegrationEvent[] = [];
let eventCounter = 0;

/** Log an integration event */
export function logIntegrationEvent(params: {
  vendor: string;
  type: IntegrationEventType;
  message: string;
  latencyMs?: number;
  error?: string;
}): void {
  eventCounter++;
  const event: IntegrationEvent = {
    id: `ie-${eventCounter}`,
    vendor: params.vendor,
    type: params.type,
    message: params.message,
    latencyMs: params.latencyMs,
    error: params.error,
    timestamp: new Date().toISOString(),
  };

  eventLog.unshift(event); // newest first
  if (eventLog.length > MAX_EVENTS) {
    eventLog.length = MAX_EVENTS;
  }

  // Console output for server logs
  const level = params.type.includes("error") || params.type.includes("failure") || params.type === "timeout" ? "error" : "info";
  const prefix = `[IntLog] [${params.vendor}]`;
  if (level === "error") {
    console.error(`${prefix} ${params.type}: ${params.message}${params.error ? ` — ${params.error}` : ""}`);
  } else {
    console.log(`${prefix} ${params.type}: ${params.message}${params.latencyMs ? ` (${params.latencyMs}ms)` : ""}`);
  }
}

/** Get recent events, optionally filtered */
export function getRecentEvents(params?: {
  vendor?: string;
  type?: IntegrationEventType;
  limit?: number;
}): IntegrationEvent[] {
  let filtered = eventLog;

  if (params?.vendor) {
    filtered = filtered.filter(e => e.vendor === params.vendor);
  }
  if (params?.type) {
    filtered = filtered.filter(e => e.type === params.type);
  }

  return filtered.slice(0, params?.limit || 50);
}

/** Get event counts by vendor and type */
export function getEventSummary(): Record<string, { total: number; errors: number; lastEvent: string | null }> {
  const summary: Record<string, { total: number; errors: number; lastEvent: string | null }> = {};

  for (const event of eventLog) {
    if (!summary[event.vendor]) {
      summary[event.vendor] = { total: 0, errors: 0, lastEvent: null };
    }
    summary[event.vendor].total++;
    if (event.type.includes("error") || event.type.includes("failure") || event.type === "timeout") {
      summary[event.vendor].errors++;
    }
    if (!summary[event.vendor].lastEvent) {
      summary[event.vendor].lastEvent = event.timestamp;
    }
  }

  return summary;
}

/** Clear log (for testing) */
export function clearEventLog(): void {
  eventLog.length = 0;
}

// ─── Smoke Test Runner ───────────────────────────────

export interface SmokeTestResult {
  vendor: string;
  passed: boolean;
  latencyMs: number;
  error?: string;
  testedAt: string;
}

/** Run smoke tests for all vendors — calls real health checks */
export async function runSmokeTests(): Promise<SmokeTestResult[]> {
  const { getVendorHealthReport, clearHealthCache } = await import("./vendorHealth");

  // Force fresh checks
  clearHealthCache();
  const report = await getVendorHealthReport();

  const results: SmokeTestResult[] = report.results.map(r => {
    const totalLatency = r.checks.reduce((sum, c) => sum + c.latencyMs, 0);
    const passed = r.status === "healthy";
    const firstError = r.checks.find(c => !c.passed)?.error;

    // Log the smoke test result
    logIntegrationEvent({
      vendor: r.vendor,
      type: "smoke_test",
      message: passed ? "Smoke test PASSED" : `Smoke test FAILED: ${firstError || "unhealthy"}`,
      latencyMs: totalLatency,
      error: passed ? undefined : firstError,
    });

    return {
      vendor: r.vendor,
      passed,
      latencyMs: totalLatency,
      error: firstError,
      testedAt: r.checkedAt,
    };
  });

  return results;
}
