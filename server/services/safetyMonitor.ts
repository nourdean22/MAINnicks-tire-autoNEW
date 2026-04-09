/**
 * Safety & Risk Monitor — Comprehensive business protection system
 *
 * Monitors 5 risk domains and generates a unified safety score:
 *   1. Financial — revenue anomalies, fraud indicators, cash flow
 *   2. Reputation — review trends, response gaps, comeback rate
 *   3. Operational — stale WOs, missed callbacks, cron failures
 *   4. Data — DB health, backup freshness, duplicates, orphans
 *   5. Compliance — SMS opt-out, expired specials, stale pricing
 *
 * Runs every 2h via Tier 3 scheduler. Telegram alerts on WARNING/CRITICAL.
 */

import { createLogger } from "../lib/logger";
import { sql } from "drizzle-orm";

const log = createLogger("safety-monitor");

// ─── Types ──────────────────────────────────────────

interface Alert {
  severity: "critical" | "warning" | "info";
  message: string;
}

interface FinancialMetrics {
  dailyRevenueVsAvg: number;
  unusualTransactions: number;
  unpaidInvoicesTotal: number;
  refundRate: number;
}

interface ReputationMetrics {
  recentNegativeReviews: number;
  avgRatingLast30: number;
  unansweredReviews: number;
  comebackRate: number;
}

interface OperationalMetrics {
  stalePendingJobs: number;
  missedCallbacks: number;
  overdueFollowups: number;
  smsOptOutRate: number;
  cronFailureRate: number;
}

interface DataMetrics {
  dbConnectionHealthy: boolean;
  lastBackupAge: number;
  orphanedRecords: number;
  duplicateCustomers: number;
}

interface ComplianceMetrics {
  smsWithoutOptOut: number;
  expiredSpecials: number;
  outdatedPricing: number;
}

interface CheckResult<T> {
  alerts: Alert[];
  metrics: T;
}

// ─── 1. Financial Safety ────────────────────────────

export async function checkFinancialSafety(): Promise<CheckResult<FinancialMetrics>> {
  const alerts: Alert[] = [];
  const metrics: FinancialMetrics = {
    dailyRevenueVsAvg: 100,
    unusualTransactions: 0,
    unpaidInvoicesTotal: 0,
    refundRate: 0,
  };

  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) {
      alerts.push({ severity: "critical", message: "Database unavailable — cannot check financial safety" });
      return { alerts, metrics };
    }

    // Today's revenue vs 30-day daily average
    const [todayRows] = await db.execute(sql`
      SELECT COALESCE(SUM(totalAmount), 0) as todayRev
      FROM invoices
      WHERE invoiceDate >= CURDATE()
        AND paymentStatus IN ('paid', 'partial')
    `);
    const todayRev = Number((todayRows as Record<string, unknown>[])?.[0]?.todayRev || 0);

    const [avgRows] = await db.execute(sql`
      SELECT COALESCE(SUM(totalAmount), 0) / GREATEST(DATEDIFF(NOW(), MIN(invoiceDate)), 1) as dailyAvg
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND paymentStatus IN ('paid', 'partial')
    `);
    const dailyAvg = Number((avgRows as Record<string, unknown>[])?.[0]?.dailyAvg || 1);

    // Only check revenue drop after noon ET (too early = no data yet)
    const etHour = parseInt(
      new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
      10,
    );
    if (dailyAvg > 0 && etHour >= 12) {
      metrics.dailyRevenueVsAvg = Math.round((todayRev / dailyAvg) * 100);
      if (metrics.dailyRevenueVsAvg < 50) {
        alerts.push({
          severity: "warning",
          message: `Daily revenue at ${metrics.dailyRevenueVsAvg}% of 30-day avg ($${Math.round(todayRev / 100)} vs $${Math.round(dailyAvg / 100)} avg)`,
        });
      }
    }

    // Unusual transactions (3x above average invoice)
    const [avgInvRows] = await db.execute(sql`
      SELECT COALESCE(AVG(totalAmount), 0) as avgInv
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        AND paymentStatus IN ('paid', 'partial')
    `);
    const avgInv = Number((avgInvRows as Record<string, unknown>[])?.[0]?.avgInv || 0);

    if (avgInv > 0) {
      const [unusualRows] = await db.execute(sql`
        SELECT COUNT(*) as cnt
        FROM invoices
        WHERE invoiceDate >= CURDATE()
          AND totalAmount > ${avgInv * 3}
      `);
      metrics.unusualTransactions = Number((unusualRows as Record<string, unknown>[])?.[0]?.cnt || 0);
      if (metrics.unusualTransactions > 0) {
        alerts.push({
          severity: "warning",
          message: `${metrics.unusualTransactions} invoice(s) today exceed 3x average ($${Math.round(avgInv * 3 / 100)}) — verify accuracy`,
        });
      }
    }

    // Unpaid invoices total
    const [unpaidRows] = await db.execute(sql`
      SELECT COALESCE(SUM(totalAmount), 0) as unpaidTotal
      FROM invoices
      WHERE paymentStatus IN ('pending', 'partial')
    `);
    metrics.unpaidInvoicesTotal = Number((unpaidRows as Record<string, unknown>[])?.[0]?.unpaidTotal || 0);
    if (metrics.unpaidInvoicesTotal > 500000) { // >$5K in cents
      alerts.push({
        severity: "warning",
        message: `Unpaid invoices total $${Math.round(metrics.unpaidInvoicesTotal / 100)} — cash flow risk`,
      });
    }

    // Refund rate (last 30 days)
    const [refundRows] = await db.execute(sql`
      SELECT
        COUNT(CASE WHEN paymentStatus = 'refunded' THEN 1 END) as refunded,
        COUNT(*) as total
      FROM invoices
      WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    `);
    const refunded = Number((refundRows as Record<string, unknown>[])?.[0]?.refunded || 0);
    const totalInv = Number((refundRows as Record<string, unknown>[])?.[0]?.total || 1);
    metrics.refundRate = Math.round((refunded / totalInv) * 100);
    if (metrics.refundRate > 5) {
      alerts.push({
        severity: "warning",
        message: `Refund rate at ${metrics.refundRate}% (${refunded}/${totalInv} invoices) — quality concern`,
      });
    }

    log.info("Financial safety check complete", { metrics });
  } catch (err) {
    log.error("Financial safety check failed", { error: (err as Error).message });
    alerts.push({ severity: "warning", message: `Financial check error: ${(err as Error).message}` });
  }

  return { alerts, metrics };
}

// ─── 2. Reputation Safety ───────────────────────────

export async function checkReputationSafety(): Promise<CheckResult<ReputationMetrics>> {
  const alerts: Alert[] = [];
  const metrics: ReputationMetrics = {
    recentNegativeReviews: 0,
    avgRatingLast30: 5.0,
    unansweredReviews: 0,
    comebackRate: 0,
  };

  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { alerts, metrics };

    // Negative reviews in last 7 days (1-2 stars)
    const [negRows] = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM review_pipeline
      WHERE \`rating\` <= 2
        AND \`createdAt\` >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    metrics.recentNegativeReviews = Number((negRows as Record<string, unknown>[])?.[0]?.cnt || 0);
    if (metrics.recentNegativeReviews >= 2) {
      alerts.push({
        severity: "critical",
        message: `${metrics.recentNegativeReviews} negative reviews in last 7 days — reputation at risk`,
      });
    } else if (metrics.recentNegativeReviews === 1) {
      alerts.push({
        severity: "warning",
        message: `1 negative review in last 7 days — monitor closely`,
      });
    }

    // 30-day avg rating
    const [avgRows] = await db.execute(sql`
      SELECT COALESCE(AVG(\`rating\`), 5) as avgRating
      FROM review_pipeline
      WHERE \`createdAt\` >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);
    metrics.avgRatingLast30 = Math.round(Number((avgRows as Record<string, unknown>[])?.[0]?.avgRating || 5) * 100) / 100;
    if (metrics.avgRatingLast30 < 4.5) {
      alerts.push({
        severity: "warning",
        message: `30-day avg rating is ${metrics.avgRatingLast30} (below 4.5 target)`,
      });
    }

    // Unanswered reviews (not reviewed by admin)
    const [unansweredRows] = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM review_pipeline
      WHERE \`reviewed\` = 0
        AND \`responseSent\` = 0
    `);
    metrics.unansweredReviews = Number((unansweredRows as Record<string, unknown>[])?.[0]?.cnt || 0);
    if (metrics.unansweredReviews > 5) {
      alerts.push({
        severity: "warning",
        message: `${metrics.unansweredReviews} reviews without response — customers notice silence`,
      });
    }

    // Comeback rate: customers returning within 30 days for same vehicle
    // (indicates the repair wasn't done right the first time)
    const [comebackRows] = await db.execute(sql`
      SELECT
        COUNT(DISTINCT i2.customerId) as comebacks,
        (SELECT COUNT(DISTINCT customerId) FROM invoices WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND paymentStatus = 'paid') as totalCustomers
      FROM invoices i1
      JOIN invoices i2 ON i1.customerId = i2.customerId
        AND i2.id != i1.id
        AND i2.invoiceDate > i1.invoiceDate
        AND i2.invoiceDate <= DATE_ADD(i1.invoiceDate, INTERVAL 30 DAY)
        AND i2.vehicleInfo = i1.vehicleInfo
      WHERE i1.invoiceDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        AND i1.paymentStatus = 'paid'
        AND i1.customerId IS NOT NULL
        AND i1.vehicleInfo IS NOT NULL
    `);
    const comebacks = Number((comebackRows as Record<string, unknown>[])?.[0]?.comebacks || 0);
    const totalCust = Number((comebackRows as Record<string, unknown>[])?.[0]?.totalCustomers || 1);
    metrics.comebackRate = Math.round((comebacks / totalCust) * 100);
    if (metrics.comebackRate > 5) {
      alerts.push({
        severity: "critical",
        message: `Comeback rate at ${metrics.comebackRate}% — ${comebacks} customers returned for same vehicle within 30 days`,
      });
    }

    log.info("Reputation safety check complete", { metrics });
  } catch (err) {
    log.error("Reputation safety check failed", { error: (err as Error).message });
    alerts.push({ severity: "warning", message: `Reputation check error: ${(err as Error).message}` });
  }

  return { alerts, metrics };
}

// ─── 3. Operational Safety ──────────────────────────

export async function checkOperationalSafety(): Promise<CheckResult<OperationalMetrics>> {
  const alerts: Alert[] = [];
  const metrics: OperationalMetrics = {
    stalePendingJobs: 0,
    missedCallbacks: 0,
    overdueFollowups: 0,
    smsOptOutRate: 0,
    cronFailureRate: 0,
  };

  try {
    // Check critical API keys
    if (!process.env.GOOGLE_PLACES_API_KEY && !process.env.GOOGLE_MAPS_API_KEY) {
      alerts.push({ severity: "warning", message: "GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY not set — review monitoring is disabled" });
    }
    if (!process.env.TWILIO_ACCOUNT_SID) {
      alerts.push({ severity: "warning", message: "Twilio not configured — all SMS features disabled" });
    }

    // Check bridge key security
    const bridgeKey = process.env.BRIDGE_API_KEY;
    if (bridgeKey && bridgeKey.length < 32) {
      alerts.push({ severity: "warning", message: `Bridge API key is only ${bridgeKey.length} chars — recommend 64+ for security` });
    }

    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { alerts, metrics };

    // Work orders stuck in same status >3 days
    const [staleWoRows] = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM work_orders
      WHERE status NOT IN ('completed', 'picked_up', 'cancelled', 'invoiced')
        AND updated_at < DATE_SUB(NOW(), INTERVAL 3 DAY)
    `);
    metrics.stalePendingJobs = Number((staleWoRows as Record<string, unknown>[])?.[0]?.cnt || 0);
    if (metrics.stalePendingJobs > 0) {
      alerts.push({
        severity: "warning",
        message: `${metrics.stalePendingJobs} work orders stuck >3 days — jobs stagnating`,
      });
    }

    // Callbacks unanswered >24h
    const [cbRows] = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM callback_requests
      WHERE status = 'new'
        AND createdAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);
    metrics.missedCallbacks = Number((cbRows as Record<string, unknown>[])?.[0]?.cnt || 0);
    if (metrics.missedCallbacks > 0) {
      alerts.push({
        severity: "warning",
        message: `${metrics.missedCallbacks} callback requests unanswered >24h — leads going cold`,
      });
    }

    // Unconfirmed bookings >24h — revenue pipeline leak
    const [unconfirmedRows] = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM bookings
      WHERE status = 'new'
        AND confirmedAt IS NULL
        AND createdAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);
    const unconfirmedCount = Number((unconfirmedRows as Record<string, unknown>[])?.[0]?.cnt || 0);
    if (unconfirmedCount > 0) {
      alerts.push({
        severity: "warning",
        message: `${unconfirmedCount} bookings unconfirmed >24h — leads going cold`,
      });
    }

    // Overdue follow-ups (pending invoices >7 days)
    const [overdueRows] = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM invoices
      WHERE paymentStatus = 'pending'
        AND invoiceDate < DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    metrics.overdueFollowups = Number((overdueRows as Record<string, unknown>[])?.[0]?.cnt || 0);
    if (metrics.overdueFollowups > 5) {
      alerts.push({
        severity: "warning",
        message: `${metrics.overdueFollowups} invoices pending >7 days without follow-up`,
      });
    }

    // SMS opt-out rate (last 30 days)
    const [optOutRows] = await db.execute(sql`
      SELECT
        COUNT(CASE WHEN smsOptOut = 1 THEN 1 END) as optedOut,
        COUNT(*) as total
      FROM customers
      WHERE updatedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);
    const optedOut = Number((optOutRows as Record<string, unknown>[])?.[0]?.optedOut || 0);
    const totalSms = Number((optOutRows as Record<string, unknown>[])?.[0]?.total || 1);
    metrics.smsOptOutRate = Math.round((optedOut / totalSms) * 100);
    if (metrics.smsOptOutRate > 3) {
      alerts.push({
        severity: "warning",
        message: `SMS opt-out rate at ${metrics.smsOptOutRate}% — messages may be too frequent or irrelevant`,
      });
    }

    // Cron failure rate (last 24h)
    const [cronRows] = await db.execute(sql`
      SELECT
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(*) as total
      FROM cron_log
      WHERE started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);
    const cronFailed = Number((cronRows as Record<string, unknown>[])?.[0]?.failed || 0);
    const cronTotal = Number((cronRows as Record<string, unknown>[])?.[0]?.total || 1);
    metrics.cronFailureRate = Math.round((cronFailed / cronTotal) * 100);
    if (metrics.cronFailureRate > 10) {
      alerts.push({
        severity: "warning",
        message: `Cron failure rate at ${metrics.cronFailureRate}% (${cronFailed}/${cronTotal}) — system instability`,
      });
    }

    log.info("Operational safety check complete", { metrics });
  } catch (err) {
    log.error("Operational safety check failed", { error: (err as Error).message });
    alerts.push({ severity: "warning", message: `Operational check error: ${(err as Error).message}` });
  }

  return { alerts, metrics };
}

// ─── 4. Data Safety ─────────────────────────────────

export async function checkDataSafety(): Promise<CheckResult<DataMetrics>> {
  const alerts: Alert[] = [];
  const metrics: DataMetrics = {
    dbConnectionHealthy: false,
    lastBackupAge: 999,
    orphanedRecords: 0,
    duplicateCustomers: 0,
  };

  try {
    const { getDb } = await import("../db");
    const db = await getDb();

    // DB health check
    if (!db) {
      alerts.push({ severity: "critical", message: "Database connection failed — all systems at risk" });
      return { alerts, metrics };
    }

    // Verify connection with a simple query
    try {
      await db.execute(sql`SELECT 1`);
      metrics.dbConnectionHealthy = true;
    } catch (e) {
      console.warn("[services/safetyMonitor] operation failed:", e);
      metrics.dbConnectionHealthy = false;
      alerts.push({ severity: "critical", message: "Database connection test failed" });
      return { alerts, metrics };
    }

    // Last backup age — check cron_log for most recent successful db-backup
    const [backupRows] = await db.execute(sql`
      SELECT completed_at
      FROM cron_log
      WHERE job_name = 'db-backup'
        AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 1
    `);
    const lastBackupAt = (backupRows as Record<string, unknown>[])?.[0]?.completed_at;
    if (lastBackupAt) {
      metrics.lastBackupAge = Math.round((Date.now() - new Date(lastBackupAt as string).getTime()) / (1000 * 60 * 60));
    }
    if (metrics.lastBackupAge > 48) {
      alerts.push({
        severity: "critical",
        message: `No successful backup in ${metrics.lastBackupAge}h — data at risk`,
      });
    } else if (metrics.lastBackupAge > 36) {
      alerts.push({
        severity: "warning",
        message: `Last backup was ${metrics.lastBackupAge}h ago — should be daily`,
      });
    }

    // Orphaned invoices (no matching customer)
    const [orphanRows] = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM invoices
      WHERE (customerPhone IS NULL OR customerPhone = '')
        AND (customerId IS NULL)
    `);
    metrics.orphanedRecords = Number((orphanRows as Record<string, unknown>[])?.[0]?.cnt || 0);
    if (metrics.orphanedRecords > 10) {
      alerts.push({
        severity: "warning",
        message: `${metrics.orphanedRecords} orphaned invoices (no customer link) — data integrity issue`,
      });
    }

    // Duplicate customer phone numbers
    const [dupRows] = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM (
        SELECT phone, COUNT(*) as dupes
        FROM customers
        WHERE phone IS NOT NULL AND phone != ''
        GROUP BY phone
        HAVING COUNT(*) > 1
      ) as dups
    `);
    metrics.duplicateCustomers = Number((dupRows as Record<string, unknown>[])?.[0]?.cnt || 0);
    if (metrics.duplicateCustomers > 0) {
      alerts.push({
        severity: "warning",
        message: `${metrics.duplicateCustomers} phone numbers have duplicate customer records — merge needed`,
      });
    }

    log.info("Data safety check complete", { metrics });
  } catch (err) {
    log.error("Data safety check failed", { error: (err as Error).message });
    alerts.push({ severity: "warning", message: `Data check error: ${(err as Error).message}` });
  }

  return { alerts, metrics };
}

// ─── 5. Compliance Safety ───────────────────────────

export async function checkComplianceSafety(): Promise<CheckResult<ComplianceMetrics>> {
  const alerts: Alert[] = [];
  const metrics: ComplianceMetrics = {
    smsWithoutOptOut: 0,
    expiredSpecials: 0,
    outdatedPricing: 0,
  };

  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { alerts, metrics };

    // SMS sent without opt-out language (outbound messages in last 7 days missing STOP)
    const [smsRows] = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM sms_messages
      WHERE direction = 'outbound'
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND body NOT LIKE '%STOP%'
        AND body NOT LIKE '%stop%'
        AND body NOT LIKE '%opt out%'
        AND body NOT LIKE '%unsubscribe%'
    `);
    metrics.smsWithoutOptOut = Number((smsRows as Record<string, unknown>[])?.[0]?.cnt || 0);
    if (metrics.smsWithoutOptOut > 0) {
      alerts.push({
        severity: "warning",
        message: `${metrics.smsWithoutOptOut} outbound SMS in last 7 days missing STOP/opt-out language`,
      });
    }

    // Expired specials still visible on website
    const [expiredRows] = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM specials
      WHERE is_active = 1
        AND display_on_website = 1
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
    `);
    metrics.expiredSpecials = Number((expiredRows as Record<string, unknown>[])?.[0]?.cnt || 0);
    if (metrics.expiredSpecials > 0) {
      alerts.push({
        severity: "warning",
        message: `${metrics.expiredSpecials} expired specials still showing on website — deactivate immediately`,
      });
    }

    // Outdated pricing: specials not updated in 90+ days
    const [stalePricingRows] = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM specials
      WHERE is_active = 1
        AND updated_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
    `);
    metrics.outdatedPricing = Number((stalePricingRows as Record<string, unknown>[])?.[0]?.cnt || 0);
    if (metrics.outdatedPricing > 0) {
      alerts.push({
        severity: "info",
        message: `${metrics.outdatedPricing} active specials not updated in 90+ days — review pricing`,
      });
    }

    log.info("Compliance safety check complete", { metrics });
  } catch (err) {
    log.error("Compliance safety check failed", { error: (err as Error).message });
    alerts.push({ severity: "warning", message: `Compliance check error: ${(err as Error).message}` });
  }

  return { alerts, metrics };
}

// ─── 6. Master Safety Check ─────────────────────────

export async function runFullSafetyCheck(): Promise<{
  overallStatus: "safe" | "warning" | "critical";
  score: number;
  financial: CheckResult<FinancialMetrics>;
  reputation: CheckResult<ReputationMetrics>;
  operational: CheckResult<OperationalMetrics>;
  data: CheckResult<DataMetrics>;
  compliance: CheckResult<ComplianceMetrics>;
  totalAlerts: number;
  criticalAlerts: number;
  checkedAt: string;
}> {
  log.info("Starting full safety check");

  // Run all checks in parallel
  const [financial, reputation, operational, data, compliance] = await Promise.all([
    checkFinancialSafety(),
    checkReputationSafety(),
    checkOperationalSafety(),
    checkDataSafety(),
    checkComplianceSafety(),
  ]);

  // Collect all alerts
  const allAlerts = [
    ...financial.alerts,
    ...reputation.alerts,
    ...operational.alerts,
    ...data.alerts,
    ...compliance.alerts,
  ];

  const totalAlerts = allAlerts.length;
  const criticalAlerts = allAlerts.filter(a => a.severity === "critical").length;
  const warningAlerts = allAlerts.filter(a => a.severity === "warning").length;

  // Calculate safety score (100 = perfect, 0 = everything on fire)
  let score = 100;
  for (const alert of allAlerts) {
    if (alert.severity === "critical") score -= 15;
    if (alert.severity === "warning") score -= 5;
    if (alert.severity === "info") score -= 1;
  }
  score = Math.max(0, Math.min(100, score));

  // Determine overall status
  let overallStatus: "safe" | "warning" | "critical" = "safe";
  if (criticalAlerts > 0) overallStatus = "critical";
  else if (warningAlerts > 0) overallStatus = "warning";

  const result = {
    overallStatus,
    score,
    financial,
    reputation,
    operational,
    data,
    compliance,
    totalAlerts,
    criticalAlerts,
    checkedAt: new Date().toISOString(),
  };

  log.info("Full safety check complete", { overallStatus, score, totalAlerts, criticalAlerts });

  // Send Telegram alerts if warranted
  try {
    await sendSafetyAlerts(result);
  } catch (err) {
    log.error("Failed to send safety alerts", { error: (err as Error).message });
  }

  return result;
}

// ─── Telegram Alert Formatting ──────────────────────

async function sendSafetyAlerts(result: Awaited<ReturnType<typeof runFullSafetyCheck>>): Promise<void> {
  const { sendTelegramMessage } = await import("./telegram");

  // Always send critical alerts regardless of feature flag
  const criticals = [
    ...result.financial.alerts,
    ...result.reputation.alerts,
    ...result.operational.alerts,
    ...result.data.alerts,
    ...result.compliance.alerts,
  ].filter(a => a.severity === "critical");

  if (criticals.length > 0) {
    const lines = [
      `🚨 <b>SAFETY CRITICAL — Score: ${result.score}/100</b>`,
      ``,
      ...criticals.map(a => `❌ ${a.message}`),
      ``,
      `⏰ ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
    ];
    await sendTelegramMessage(lines.join("\n"), "critical");
  }

  // Gate non-critical alerts behind feature flag
  const { isEnabled } = await import("./featureFlags");
  const alertsEnabled = await isEnabled("safety_monitor_enabled");

  if (!alertsEnabled) return;

  const warnings = [
    ...result.financial.alerts,
    ...result.reputation.alerts,
    ...result.operational.alerts,
    ...result.data.alerts,
    ...result.compliance.alerts,
  ].filter(a => a.severity === "warning");

  if (warnings.length > 0) {
    const statusEmoji = result.overallStatus === "warning" ? "⚠️" : "✅";
    const lines = [
      `${statusEmoji} <b>SAFETY CHECK — Score: ${result.score}/100</b>`,
      ``,
      ...warnings.map(a => `⚠️ ${a.message}`),
      ``,
      `📊 Financial: ${result.financial.alerts.length} | Reputation: ${result.reputation.alerts.length} | Ops: ${result.operational.alerts.length} | Data: ${result.data.alerts.length} | Compliance: ${result.compliance.alerts.length}`,
    ];
    await sendTelegramMessage(lines.join("\n"), "system");
  }
}

// ─── Cron Job Handler ───────────────────────────────

/**
 * Handler for the tiered scheduler. Returns in the standard
 * { recordsProcessed, details } format.
 */
export async function runSafetyCheckJob(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const result = await runFullSafetyCheck();
    return {
      recordsProcessed: result.totalAlerts,
      details: `Safety ${result.overallStatus} (${result.score}/100) — ${result.totalAlerts} alerts (${result.criticalAlerts} critical)`,
    };
  } catch (err) {
    log.error("Safety check job failed", { error: (err as Error).message });
    return { recordsProcessed: 0, details: `Error: ${(err as Error).message}` };
  }
}
