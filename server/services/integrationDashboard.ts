/**
 * Integration Dashboard — Aggregated health view across ALL external integrations.
 *
 * Provides a single `getIntegrationHealth()` function that returns:
 * - Status of every integration (healthy/degraded/down)
 * - Last success time, failure count, avg latency
 * - Circuit breaker state for each service
 * - SLA data (uptime %, avg response time)
 * - Delivery stats for SMS, Email, Telegram
 *
 * Used by the admin panel to display a unified integration health dashboard.
 */

import { createLogger } from "../lib/logger";
import { getAllBreakerHealth, type CircuitHealth } from "../lib/circuit-breaker";

const log = createLogger("integration-dashboard");

// ─── Types ──────────────────────────────────────────

export interface IntegrationStatus {
  name: string;
  category: "messaging" | "vendor" | "internal" | "payment";
  status: "healthy" | "degraded" | "down" | "not_configured" | "unknown";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  avgLatencyMs: number;
  circuitBreaker: CircuitHealth | null;
  details: Record<string, unknown>;
}

export interface IntegrationHealthReport {
  timestamp: string;
  overallStatus: "operational" | "degraded" | "partial_outage" | "major_outage";
  integrations: IntegrationStatus[];
  circuitBreakers: CircuitHealth[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    down: number;
    notConfigured: number;
  };
}

// ─── Data Collectors ────────────────────────────────

async function getTelegramStatus(): Promise<IntegrationStatus> {
  try {
    const { getTelegramStats } = await import("./telegram");
    const stats = getTelegramStats();

    const breakers = getAllBreakerHealth();
    const cb = breakers.find((b) => b.service === "telegram") || null;

    return {
      name: "Telegram Notifications",
      category: "messaging",
      status: cb?.state === "OPEN" ? "down" : stats.lastError && stats.failed > stats.sent ? "degraded" : "healthy",
      lastSuccessAt: stats.lastSentAt,
      lastFailureAt: stats.lastError ? new Date().toISOString() : null,
      failureCount: stats.failed,
      avgLatencyMs: 0,
      circuitBreaker: cb,
      details: {
        sent: stats.sent,
        failed: stats.failed,
        queued: stats.queued,
        batched: stats.batched,
        queueSize: stats.queueSize,
      },
    };
  } catch {
    return unknownStatus("Telegram Notifications", "messaging");
  }
}

async function getEmailStatus(): Promise<IntegrationStatus> {
  try {
    const { getEmailStats, getDeliveryLog } = await import("../email-notify");
    const stats = getEmailStats();
    const recentLog = getDeliveryLog(10);

    const breakers = getAllBreakerHealth();
    const cb = breakers.find((b) => b.service === "email-gmail") || null;

    return {
      name: "Email (Gmail MCP)",
      category: "messaging",
      status: cb?.state === "OPEN" ? "down" : stats.deliveryRate < 50 ? "degraded" : "healthy",
      lastSuccessAt: stats.lastSentAt,
      lastFailureAt: stats.lastFailureAt,
      failureCount: stats.totalFailed,
      avgLatencyMs: 0,
      circuitBreaker: cb,
      details: {
        totalSent: stats.totalSent,
        totalFailed: stats.totalFailed,
        totalBounced: stats.totalBounced,
        deliveryRate: stats.deliveryRate,
        recentDeliveries: recentLog.length,
      },
    };
  } catch {
    return unknownStatus("Email (Gmail MCP)", "messaging");
  }
}

async function getSmsStatus(): Promise<IntegrationStatus> {
  try {
    const { getSmsStats } = await import("../sms");
    const stats = getSmsStats();

    const breakers = getAllBreakerHealth();
    const cb = breakers.find((b) => b.service === "twilio-sms") || null;

    return {
      name: "SMS (Twilio)",
      category: "messaging",
      status: cb?.state === "OPEN" ? "down" : stats.deliveryRate < 50 ? "degraded" : "healthy",
      lastSuccessAt: stats.lastSentAt,
      lastFailureAt: stats.lastError ? new Date().toISOString() : null,
      failureCount: stats.totalFailed,
      avgLatencyMs: 0,
      circuitBreaker: cb,
      details: {
        totalSent: stats.totalSent,
        totalFailed: stats.totalFailed,
        totalDelivered: stats.totalDelivered,
        totalOptedOut: stats.totalOptedOut,
        deliveryRate: stats.deliveryRate,
        delayedQueueSize: stats.delayedQueueSize,
        activeThreads: stats.activeThreads,
      },
    };
  } catch {
    return unknownStatus("SMS (Twilio)", "messaging");
  }
}

async function getNourOsStatus(): Promise<IntegrationStatus> {
  try {
    const { getSyncStatus, getEventAnalytics } = await import("../nour-os-bridge");
    const status = getSyncStatus();
    const analytics = status.analytics;

    const breakers = getAllBreakerHealth();
    const cb = breakers.find((b) => b.service === "nour-os-cloud") || null;

    return {
      name: "NOUR OS Bridge",
      category: "internal",
      status: cb?.state === "OPEN" ? "down" : status.lastError ? "degraded" : "healthy",
      lastSuccessAt: analytics.lastCloudSuccessAt,
      lastFailureAt: analytics.lastCloudErrorAt,
      failureCount: analytics.totalCloudFailures,
      avgLatencyMs: analytics.avgCloudLatencyMs,
      circuitBreaker: cb,
      details: {
        totalDispatched: analytics.totalDispatched,
        totalLocalWrites: analytics.totalLocalWrites,
        totalCloudPushes: analytics.totalCloudPushes,
        totalDeduplicated: analytics.totalDeduplicated,
        totalRetried: analytics.totalRetried,
        retryQueueSize: status.retryQueueSize,
        cloudHealthy: status.cloudHealthy,
        eventsByType: analytics.eventsByType,
      },
    };
  } catch {
    return unknownStatus("NOUR OS Bridge", "internal");
  }
}

async function getVendorStatuses(): Promise<IntegrationStatus[]> {
  try {
    const { getVendorHealthReport, getVendorSLA, getVendorCosts } = await import("./vendorHealth");
    const report = await getVendorHealthReport();
    const costs = getVendorCosts();

    return report.results.map((r) => {
      const sla = Array.isArray(getVendorSLA(r.vendor))
        ? null
        : (getVendorSLA(r.vendor) as any);
      const cost = costs.find((c) => c.vendor === r.vendor);

      const category: IntegrationStatus["category"] =
        r.vendor === "Stripe Payments" ? "payment" :
        r.vendor === "Database" ? "internal" :
        r.vendor === "NOUR OS Bridge" ? "internal" : "vendor";

      return {
        name: r.vendor,
        category,
        status: r.status,
        lastSuccessAt: sla?.lastCheckAt || null,
        lastFailureAt: sla?.lastDownAt || null,
        failureCount: sla ? sla.totalChecks - sla.successfulChecks : 0,
        avgLatencyMs: sla?.avgResponseMs || 0,
        circuitBreaker: null,
        details: {
          checks: r.checks.map((c) => ({ name: c.name, passed: c.passed, latencyMs: c.latencyMs })),
          uptimePercent: sla?.uptimePercent,
          downtimeMinutes: sla?.downtimeMinutes,
          apiCallsToday: cost?.apiCallsToday,
          estimatedCostToday: cost?.estimatedCostToday,
        },
      } as IntegrationStatus;
    });
  } catch {
    return [];
  }
}

function unknownStatus(name: string, category: IntegrationStatus["category"]): IntegrationStatus {
  return {
    name,
    category,
    status: "unknown",
    lastSuccessAt: null,
    lastFailureAt: null,
    failureCount: 0,
    avgLatencyMs: 0,
    circuitBreaker: null,
    details: { error: "Could not collect status" },
  };
}

// ─── Main Dashboard Function ────────────────────────

/**
 * Get aggregated health status across ALL integrations.
 * This is the single function the admin panel calls.
 */
export async function getIntegrationHealth(): Promise<IntegrationHealthReport> {
  const [telegram, email, sms, nourOs, vendors] = await Promise.allSettled([
    getTelegramStatus(),
    getEmailStatus(),
    getSmsStatus(),
    getNourOsStatus(),
    getVendorStatuses(),
  ]);

  const integrations: IntegrationStatus[] = [];

  // Add messaging integrations
  if (telegram.status === "fulfilled") integrations.push(telegram.value);
  else integrations.push(unknownStatus("Telegram Notifications", "messaging"));

  if (email.status === "fulfilled") integrations.push(email.value);
  else integrations.push(unknownStatus("Email (Gmail MCP)", "messaging"));

  if (sms.status === "fulfilled") integrations.push(sms.value);
  else integrations.push(unknownStatus("SMS (Twilio)", "messaging"));

  if (nourOs.status === "fulfilled") integrations.push(nourOs.value);
  else integrations.push(unknownStatus("NOUR OS Bridge", "internal"));

  // Add vendor integrations (skip duplicates already covered)
  if (vendors.status === "fulfilled") {
    for (const v of vendors.value) {
      // Don't duplicate NOUR OS Bridge which is already added above
      if (v.name === "NOUR OS Bridge") continue;
      integrations.push(v);
    }
  }

  // Get all circuit breaker states
  const circuitBreakers = getAllBreakerHealth();

  // Compute summary
  const summary = {
    total: integrations.length,
    healthy: integrations.filter((i) => i.status === "healthy").length,
    degraded: integrations.filter((i) => i.status === "degraded").length,
    down: integrations.filter((i) => i.status === "down").length,
    notConfigured: integrations.filter((i) => i.status === "not_configured").length,
  };

  // Determine overall status
  let overallStatus: IntegrationHealthReport["overallStatus"] = "operational";
  if (summary.down > 2 || summary.down > summary.total * 0.3) {
    overallStatus = "major_outage";
  } else if (summary.down > 0) {
    overallStatus = "partial_outage";
  } else if (summary.degraded > 0) {
    overallStatus = "degraded";
  }

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    integrations,
    circuitBreakers,
    summary,
  };
}

/**
 * Get a compact health summary (for quick checks / API responses).
 */
export async function getHealthSummary(): Promise<{
  status: string;
  healthy: number;
  total: number;
  issues: string[];
}> {
  const report = await getIntegrationHealth();
  const issues = report.integrations
    .filter((i) => i.status === "down" || i.status === "degraded")
    .map((i) => `${i.name}: ${i.status}`);

  return {
    status: report.overallStatus,
    healthy: report.summary.healthy,
    total: report.summary.total,
    issues,
  };
}
