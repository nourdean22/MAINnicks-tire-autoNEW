/**
 * Tiered Job Scheduler — Consolidates 24 cron jobs into 4 tiers.
 *
 * Instead of 24 separate setInterval timers, we run 4 master tiers
 * that batch related jobs together. This reduces timer overhead,
 * prevents DB connection stampedes, and makes the system easier
 * to monitor.
 *
 * TIER 1 (5 min):  Heartbeat — critical monitoring + SMS
 * TIER 2 (15 min): Pulse — dashboard sync, vendor health, form recovery
 * TIER 3 (2 hr):   Hourly — lead follow-up, intelligence, reviews
 * TIER 4 (24 hr):  Daily — segmentation, retention, reports, cleanup
 *
 * Each tier runs its jobs SEQUENTIALLY within the tier to avoid
 * DB connection stampedes. Jobs still have individual timeout + skip
 * protection from the existing runJob() infrastructure.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("scheduler");

interface TieredJob {
  name: string;
  handler: () => Promise<{ recordsProcessed?: number; details?: string }>;
  /** Only run during business hours (7 AM - 9 PM ET) */
  businessHoursOnly?: boolean;
  /** Only run if this env var is set */
  requiresEnv?: string;
  /** Skip if disabled */
  enabled?: boolean;
}

interface Tier {
  name: string;
  intervalMs: number;
  jobs: TieredJob[];
  running: boolean;
  lastRun: Date | null;
  handle?: ReturnType<typeof setInterval>;
}

const tiers: Tier[] = [];

function isBusinessHours(): boolean {
  const etHour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    10,
  );
  return etHour >= 7 && etHour <= 21;
}

/**
 * Run all jobs in a tier sequentially (not in parallel).
 * Sequential prevents DB connection stampedes on small servers.
 */
async function runTier(tier: Tier): Promise<void> {
  if (tier.running) {
    log.info(`Tier ${tier.name} still running, skipping`);
    return;
  }

  tier.running = true;
  const start = Date.now();
  let completed = 0;
  let skipped = 0;

  for (const job of tier.jobs) {
    // Skip disabled jobs
    if (job.enabled === false) { skipped++; continue; }

    // Skip business-hours-only jobs outside hours
    if (job.businessHoursOnly && !isBusinessHours()) { skipped++; continue; }

    // Skip jobs that need a missing env var
    if (job.requiresEnv && !process.env[job.requiresEnv]) { skipped++; continue; }

    let jobTimer: ReturnType<typeof setTimeout> | undefined;
    const jobStart = Date.now();
    try {
      const result = await Promise.race([
        job.handler(),
        new Promise<never>((_, reject) => {
          jobTimer = setTimeout(() => reject(new Error("timeout")), 4 * 60 * 1000);
        }),
      ]) as { recordsProcessed?: number; details?: string };
      completed++;
      const dur = Date.now() - jobStart;
      if (dur > 5000) {
        log.info(`[${tier.name}] ${job.name}: ${dur}ms`);
      }
      // Log to cron_log table for audit trail
      logTierJob(job.name, "completed", dur, result?.recordsProcessed, result?.details).catch(() => {});
    } catch (err) {
      const dur = Date.now() - jobStart;
      log.error(`[${tier.name}] ${job.name} failed:`, { error: err instanceof Error ? err.message : String(err) });
      logTierJob(job.name, "failed", dur, 0, err instanceof Error ? err.message : String(err)).catch(() => {});
    } finally {
      if (jobTimer) clearTimeout(jobTimer);
    }
  }

  tier.running = false;
  tier.lastRun = new Date();
  const totalMs = Date.now() - start;
  if (completed > 0) {
    log.info(`Tier ${tier.name}: ${completed} completed, ${skipped} skipped (${totalMs}ms)`);
  }
}

/** Log tier job execution to cron_log table */
async function logTierJob(jobName: string, status: string, durationMs: number, recordsProcessed?: number, details?: string): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { cronLog } = await import("../../drizzle/schema");
    const { randomUUID } = await import("crypto");
    const db = await getDb();
    if (!db) return;
    await db.insert(cronLog).values({
      id: randomUUID(),
      jobName,
      status,
      durationMs,
      recordsProcessed: recordsProcessed || 0,
      details: details?.slice(0, 2000) || null,
      startedAt: new Date(Date.now() - durationMs),
      completedAt: new Date(),
    });
  } catch {}
}

/**
 * Register all tiers and start the consolidated scheduler.
 */
export function startTieredScheduler(): void {
  // ═══ TIER 1: HEARTBEAT (every 5 min) ═══
  // Critical monitoring + SMS processing
  tiers.push({
    name: "heartbeat",
    intervalMs: 5 * 60 * 1000,
    jobs: [
      {
        name: "self-healing",
        handler: async () => {
          const { runSelfHealingChecks } = await import("../services/selfHealing");
          return runSelfHealingChecks();
        },
      },
      {
        name: "alg-mirror-health", // CRITICAL: detect stale ALG data fast
        businessHoursOnly: true,
        handler: async () => {
          const { checkMirrorHealth } = await import("../services/shopDriverMirror");
          return checkMirrorHealth();
        },
      },
      {
        name: "data-accuracy-check",
        handler: async () => {
          // Verify data consistency every 5 minutes
          const issues: string[] = [];
          try {
            const { getDb } = await import("../db");
            const { sql } = await import("drizzle-orm");
            const d = await getDb();
            if (!d) return { details: "No DB" };

            // Check for orphaned invoices (no matching customer phone)
            const [orphanedInvoices] = await d.execute(sql`SELECT COUNT(*) as cnt FROM invoices WHERE customerPhone IS NULL OR customerPhone = ''`);
            const orphanCount = (orphanedInvoices as any)?.[0]?.cnt || (orphanedInvoices as any)?.cnt || 0;
            if (Number(orphanCount) > 0) issues.push(`${orphanCount} invoices missing customer phone`);

            // Check for stale leads (new status > 7 days old)
            const [staleLeads] = await d.execute(sql`SELECT COUNT(*) as cnt FROM leads WHERE status = 'new' AND createdAt < DATE_SUB(NOW(), INTERVAL 7 DAY)`);
            const staleCount = (staleLeads as any)?.[0]?.cnt || (staleLeads as any)?.cnt || 0;
            if (Number(staleCount) > 3) issues.push(`${staleCount} stale leads (>7d untouched)`);

            // Check for callbacks stuck in "new" > 24h
            const [staleCallbacks] = await d.execute(sql`SELECT COUNT(*) as cnt FROM callback_requests WHERE status = 'new' AND createdAt < DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
            const cbCount = (staleCallbacks as any)?.[0]?.cnt || (staleCallbacks as any)?.cnt || 0;
            if (Number(cbCount) > 0) issues.push(`${cbCount} callbacks unanswered >24h`);

            if (issues.length > 0) {
              // Log internally only — no external notifications
              const { createLogger } = await import("../lib/logger");
              const accuracyLog = createLogger("cron:data-accuracy");
              accuracyLog.warn("Data accuracy issues found", { issues });
              const { remember } = await import("../services/nickMemory");
              await remember({ type: "lesson", content: `Data accuracy: ${issues.join(". ")}`, source: "accuracy_check", confidence: 0.8 });
            }

            return { recordsProcessed: issues.length, details: issues.length === 0 ? "All data clean" : issues.join("; ") };
          } catch { return { details: "Accuracy check failed" }; }
        },
      },
    ],
    running: false,
    lastRun: null,
  });

  // ═══ TIER 2: PULSE (every 15 min) ═══
  // Optimized order: health first → data refresh → customer-facing actions last
  tiers.push({
    name: "pulse",
    intervalMs: 15 * 60 * 1000,
    jobs: [
      {
        name: "vendor-health", // First: know if systems are up before syncing
        handler: async () => {
          const { getVendorHealthReport } = await import("../services/vendorHealth");
          const report = await getVendorHealthReport();
          const unhealthy = report.results.filter((s: any) => s.status === "down").length;
          return { recordsProcessed: report.results.length, details: `${unhealthy} unhealthy` };
        },
      },
      {
        name: "dashboard-sync",
        handler: async () => {
          const { processDashboardSync } = await import("./jobs/dashboardSync");
          return processDashboardSync();
        },
      },
      {
        name: "cloud-camera-snapshots",
        handler: async () => {
          const { pullCloudCameraSnapshots } = await import("../services/cameraProxy");
          return pullCloudCameraSnapshots();
        },
      },
      {
        name: "shopdriver-mirror",
        businessHoursOnly: true,
        handler: async () => {
          const { runFullMirror } = await import("../services/shopDriverMirror");
          return runFullMirror();
        },
      },
      {
        name: "abandoned-forms",
        businessHoursOnly: true, // No customer outreach at 3am
        handler: async () => {
          const { processAbandonedForms } = await import("../services/abandonedForms");
          return processAbandonedForms();
        },
      },
      {
        name: "sms-scheduler", // Moved from heartbeat (5min was overkill)
        businessHoursOnly: true,
        handler: async () => {
          const { processAppointmentReminders24h } = await import("./jobs/appointmentReminders");
          return processAppointmentReminders24h();
        },
      },
      {
        name: "wo-overdue-check", // Detect work orders past promised time
        businessHoursOnly: true,
        handler: async () => {
          const { detectOverdueWorkOrders } = await import("../services/workOrderAutomation");
          return detectOverdueWorkOrders();
        },
      },
      {
        name: "gateway-order-status-poll", // Detect stale/stuck tire orders
        businessHoursOnly: true,
        handler: async () => {
          const { pollGatewayOrderStatuses } = await import("../services/dataPipelines");
          return pollGatewayOrderStatuses();
        },
      },
      {
        name: "revenue-pulse", // Live revenue pacing — alert on big jobs or falling behind
        businessHoursOnly: true,
        handler: async () => {
          try {
            const { forecastRevenue } = await import("../services/intelligenceEngines");
            const forecast = await forecastRevenue();
            const todayRevenue = forecast.today?.soFar || 0;
            const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
            const dailyTarget = 20000 / daysInMonth;

            // Alert if a single big job came in (>$1000)
            if (todayRevenue > 1000 && todayRevenue > dailyTarget * 2) {
              const { sendTelegram } = await import("../services/telegram");
              await sendTelegram(`💰 Big day building: $${Math.round(todayRevenue)} so far today (${Math.round((todayRevenue/dailyTarget)*100)}% of daily target)`);
            }
            return { recordsProcessed: 1, details: `Today: $${Math.round(todayRevenue)}` };
          } catch { return { details: "Revenue pulse skipped" }; }
        },
      },
      {
        name: "statenour-live-sync", // Push fresh data to NOUR OS dashboard every 15min
        handler: async () => {
          const { syncToStatenour } = await import("./jobs/statenourSync");
          return syncToStatenour();
        },
      },
    ],
    running: false,
    lastRun: null,
  });

  // ═══ TIER 3: HOURLY (every 2 hr) ═══
  // Intelligence, follow-ups, syncs
  tiers.push({
    name: "hourly",
    intervalMs: 2 * 60 * 60 * 1000,
    // Optimized order: data quality → brain sync → intelligence → actions → outreach
    jobs: [
      {
        name: "feedback-cycle", // FIRST: decay memories, check anomalies, pacing — feeds into intelligence quality
        handler: async () => {
          const { runFeedbackCycle } = await import("../services/feedbackLoop");
          return runFeedbackCycle();
        },
      },
      {
        name: "pull-from-statenour-brain", // SECOND: get fresh brain data before intelligence runs
        handler: async () => {
          const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-os.vercel.app";
          const syncKey = process.env.STATENOUR_SYNC_KEY || "";
          if (!syncKey) return { details: "No sync key" };
          try {
            const res = await fetch(`${statenourUrl}/api/sync/nour-os`, {
              headers: { "x-sync-key": syncKey },
              signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) return { details: `HTTP ${res.status}` };
            const data = await res.json();
            const brain = data?.data || data;
            const { remember } = await import("../services/nickMemory");
            let imported = 0;

            // Pull insights (brain analysis, reflections, predictions)
            for (const insight of (brain.recentInsights || []).slice(0, 5)) {
              await remember({ type: "insight", content: `[statenour] ${insight.title || insight.content || ""}`.slice(0, 500), source: "statenour_pull", confidence: 0.8 });
              imported++;
            }

            // Pull patterns (behavioral, business, personal)
            for (const pattern of (brain.patterns || []).slice(0, 3)) {
              await remember({ type: "pattern", content: `[statenour-pattern] ${pattern.name || ""}: ${pattern.description || ""}`.slice(0, 500), source: "statenour_patterns", confidence: 0.75 });
              imported++;
            }

            // Pull predictions (what statenour brain thinks will happen)
            for (const pred of (brain.predictions || []).slice(0, 2)) {
              await remember({ type: "insight", content: `[statenour-prediction] ${pred.title || pred.prediction || ""} — confidence: ${pred.confidence || "?"}`.slice(0, 500), source: "statenour_predictions", confidence: 0.7 });
              imported++;
            }

            // Pull contradictions (things the brain flagged as inconsistent)
            for (const contra of (brain.contradictions || []).slice(0, 2)) {
              await remember({ type: "lesson", content: `[statenour-contradiction] ${contra.description || contra.message || ""}`.slice(0, 500), source: "statenour_contradictions", confidence: 0.85 });
              imported++;
            }

            // Pull open loops (unresolved items Nour should address)
            for (const loop of (brain.openLoops || []).slice(0, 3)) {
              await remember({ type: "insight", content: `[statenour-open-loop] ${loop.title || loop.text || ""} — status: ${loop.status || "open"}`.slice(0, 500), source: "statenour_loops", confidence: 0.6 });
              imported++;
            }

            // Pull commitments (things Nour committed to)
            for (const commit of (brain.commitments || []).slice(0, 2)) {
              await remember({ type: "preference", content: `[statenour-commitment] ${commit.text || commit.title || ""} — deadline: ${commit.deadline || "none"}, status: ${commit.status || "active"}`.slice(0, 500), source: "statenour_commitments", confidence: 0.9 });
              imported++;
            }

            // Handle drift alerts — urgent ones trigger immediate Telegram
            const driftAlerts = (brain.driftAlerts || brain.alerts || []).filter((a: any) => a.severity === "critical" || a.urgent);
            if (driftAlerts.length > 0) {
              try {
                const { sendUrgentBrief } = await import("./jobs/morningBrief");
                await sendUrgentBrief("NOUR OS Drift Alert", driftAlerts.map((a: any) => a.message || a.title || String(a)).join("\n"));
              } catch {}
            }

            // Non-urgent alerts still stored as memories
            for (const alert of (brain.driftAlerts || []).filter((a: any) => !a.urgent).slice(0, 3)) {
              await remember({ type: "lesson", content: `[statenour-alert] ${alert.message || alert.ruleName || ""}`.slice(0, 500), source: "statenour_alerts", confidence: 0.7 });
              imported++;
            }

            return { recordsProcessed: imported, details: `${imported} items pulled (insights+patterns+predictions+loops+alerts), ${driftAlerts.length} urgent` };
          } catch { return { details: "Pull failed" }; }
        },
      },
      {
        name: "memory-sync-to-statenour", // THIRD: push our memories out
        handler: async () => {
          const { syncMemoriesToStatenour } = await import("../services/nickMemory");
          const count = await syncMemoriesToStatenour();
          return { recordsProcessed: count, details: `${count} memories synced to statenour` };
        },
      },
      {
        name: "nick-intelligence", // FOURTH: analyze with fresh data
        businessHoursOnly: true,
        handler: async () => {
          const { runProactiveCheck } = await import("../services/nickIntelligence");
          return runProactiveCheck();
        },
      },
      {
        name: "nick-auto-actions", // FIFTH: act on intelligence
        businessHoursOnly: true,
        handler: async () => {
          const { runAutoActions } = await import("../services/nickIntelligence");
          return runAutoActions();
        },
      },
      {
        name: "auto-labor-guide-sync", // Auto Labor Guide data sync
        businessHoursOnly: true,
        handler: async () => {
          try {
            const { pullRecentTickets } = await import("../services/shopDriverSync");
            const tickets = await pullRecentTickets();
            if (tickets.length > 0) {
              const { remember } = await import("../services/nickMemory");
              await remember({
                type: "insight",
                content: `ALG sync: ${tickets.length} recent tickets pulled. Latest: ${tickets.slice(0, 3).map((t: any) => `${t.customerName || "?"} ($${t.totalAmount || 0})`).join(", ")}`,
                source: "alg_sync",
                confidence: 0.8,
              });
            }
            return { recordsProcessed: tickets.length, details: `${tickets.length} ALG tickets synced` };
          } catch { return { details: "ALG sync failed" }; }
        },
      },
      {
        name: "customer-segment-refresh",
        businessHoursOnly: true,
        handler: async () => {
          try {
            const { processCustomerSegmentation } = await import("./jobs/customerSegmentation");
            return processCustomerSegmentation();
          } catch { return { details: "Segmentation skipped" }; }
        },
      },
      {
        name: "intelligence-autopilot", // Autonomous intelligence — alerts, scoring, pacing
        businessHoursOnly: true,
        handler: async () => {
          const { runIntelligenceAutopilot } = await import("./jobs/intelligenceAutopilot");
          return runIntelligenceAutopilot();
        },
      },
      {
        name: "intelligence-engines-live", // Cross-sell, LTV, lead scoring, attribution — every 2h not daily
        businessHoursOnly: true,
        handler: async () => {
          const { scoreLeads, predictCustomerLTV, trackCampaignAttribution, analyzeDeclinedWork } = await import("../services/intelligenceEngines");
          const [leads, ltv, attr, declined] = await Promise.all([
            scoreLeads().catch(() => []),
            predictCustomerLTV().catch(() => ({ segments: {} })),
            trackCampaignAttribution().catch(() => ({})),
            analyzeDeclinedWork().catch(() => ({ totalDeclinedValue: 0 })),
          ]);
          return { recordsProcessed: (leads as any[]).length, details: `Scored ${(leads as any[]).length} leads, LTV+attribution+declined updated` };
        },
      },
      {
        name: "stale-lead-followup", // outreach after intelligence is fresh
        businessHoursOnly: true,
        handler: async () => {
          const { processStaleLeadFollowUp } = await import("./jobs/staleLeadFollowup");
          return processStaleLeadFollowUp();
        },
      },
      {
        name: "review-requests", // Moved from pulse (15min was too aggressive)
        businessHoursOnly: true,
        handler: async () => {
          const { processReviewRequests } = await import("./jobs/reviewRequests");
          return processReviewRequests();
        },
      },
      {
        name: "promise-risk-check", // NEW: detect work orders about to miss promised time
        businessHoursOnly: true,
        handler: async () => {
          try {
            const { getPromiseRiskSummary } = await import("../services/promiseRisk");
            const risk = await getPromiseRiskSummary();
            const atRiskJobs = (risk.jobs || []).filter((r: any) => r.risk === "at_risk" || r.risk === "likely_late" || r.risk === "overdue");
            if (atRiskJobs.length > 0) {
              const { sendTelegram } = await import("../services/telegram");
              await sendTelegram(
                `⏰ PROMISE RISK: ${atRiskJobs.length} work orders at risk!\n\n` +
                atRiskJobs.slice(0, 3).map((r: any) => `WO#${r.orderNumber || r.id}: ${r.customerName || "?"} — ${r.risk}`).join("\n")
              );
            }
            return { recordsProcessed: atRiskJobs.length, details: `${atRiskJobs.length} at-risk WOs` };
          } catch { return { details: "Promise risk check skipped" }; }
        },
      },
      {
        name: "stale-estimate-alert",
        businessHoursOnly: true,
        handler: async () => {
          try {
            const { getDb } = await import("../db");
            const { sql: rawSql } = await import("drizzle-orm");
            const d = await getDb();
            if (!d) return { details: "No DB" };
            const [rows] = await d.execute(rawSql`
              SELECT customerName, totalAmount, invoiceDate, DATEDIFF(NOW(), invoiceDate) as daysOld
              FROM invoices WHERE paymentStatus = 'pending'
              AND invoiceDate < DATE_SUB(NOW(), INTERVAL 3 DAY)
              ORDER BY totalAmount DESC LIMIT 5
            `);
            const stale = rows as any[];
            if (stale.length > 0) {
              const { sendTelegram } = await import("../services/telegram");
              const totalPotential = stale.reduce((s: number, e: any) => s + Number(e.totalAmount || 0), 0);
              await sendTelegram(
                `💰 STALE ESTIMATES — ${stale.length} pending 3+ days ($${Math.round(totalPotential/100)})\n\n` +
                stale.map((e: any) => `${e.customerName} — $${Math.round(Number(e.totalAmount)/100)} (${e.daysOld}d old)`).join("\n") +
                `\n\nFollow up NOW — every day = lost conversion probability.`
              );
            }
            return { recordsProcessed: stale.length, details: `${stale.length} stale estimates alerted` };
          } catch { return { details: "Stale estimate check failed" }; }
        },
      },
      {
        name: "predictive-escalation",
        businessHoursOnly: true,
        handler: async () => {
          try {
            const { sendEscalationAlerts } = await import("../services/nickIntelligence");
            const result = await sendEscalationAlerts();
            return { recordsProcessed: result.sent, details: `${result.sent} escalation alerts sent` };
          } catch { return { details: "Escalation check skipped" }; }
        },
      },
      {
        name: "sync-visit-dates", // Update customer lastVisitDate from invoices + WOs
        handler: async () => {
          const { syncVisitDatesFromInvoices } = await import("../services/dataPipelines");
          return syncVisitDatesFromInvoices();
        },
      },
      {
        name: "enrich-customer-data", // Merge totalSpent, visitCount, vehicle from all sources
        handler: async () => {
          const { enrichCustomerData } = await import("../services/dataPipelines");
          return enrichCustomerData();
        },
      },
      {
        name: "drip-step-processor", // Process multi-step drip campaigns (Gap 2 fix)
        businessHoursOnly: true,
        handler: async () => {
          const { processDripSteps } = await import("../services/dripProcessor");
          return processDripSteps();
        },
      },
      {
        name: "winback-auto-process", // Auto-send pending winback messages (Gap 4 fix)
        businessHoursOnly: true,
        handler: async () => {
          const { processWinbackPending } = await import("../services/winbackProcessor");
          return processWinbackPending();
        },
      },
      {
        name: "campaign-auto-retry", // Auto-send review+referral campaign (was manual button)
        businessHoursOnly: true,
        handler: async () => {
          const { autoCampaignRetry } = await import("../services/workOrderAutomation");
          return autoCampaignRetry();
        },
      },
      // statenour-sync moved to pulse tier (15min) for live dashboard — no longer needed here
    ],
    running: false,
    lastRun: null,
  });

  // ═══ TIER 4: DAILY (every 24 hr) ═══
  // Everything that runs once a day — batched together
  tiers.push({
    name: "daily",
    intervalMs: 24 * 60 * 60 * 1000,
    jobs: [
      {
        name: "db-backup",
        handler: async () => {
          const { runDailyBackup } = await import("../services/dbBackup");
          return runDailyBackup();
        },
      },
      {
        name: "engine-health",
        handler: async () => {
          const { runHealthCheck } = await import("../services/failover");
          return runHealthCheck();
        },
      },
      {
        name: "shopdriver-daily-ticket-pull",
        handler: async () => {
          const { pullRecentTickets } = await import("../services/shopDriverSync");
          const tickets = await pullRecentTickets();
          return { recordsProcessed: tickets.length, details: `Pulled ${tickets.length} tickets from ShopDriver` };
        },
      },
      {
        name: "shopdriver-full-mirror",
        handler: async () => {
          const { runFullMirror } = await import("../services/shopDriverMirror");
          return runFullMirror();
        },
      },
      // NOTE: Also runs in hourly tier for more frequent updates
      {
        name: "cleanup",
        handler: async () => {
          const { cleanupOldData } = await import("./jobs/cleanup");
          return cleanupOldData();
        },
      },
      {
        name: "customer-segmentation",
        handler: async () => {
          const { processCustomerSegmentation } = await import("./jobs/customerSegmentation");
          return processCustomerSegmentation();
        },
      },
      {
        name: "retention-all",
        handler: async () => {
          const { processRetention90Day, processRetention180Day, processRetention365Day } = await import("./jobs/retentionSequences");
          const r90 = await processRetention90Day();
          const r180 = await processRetention180Day();
          const r365 = await processRetention365Day();
          return {
            recordsProcessed: (r90.recordsProcessed || 0) + (r180.recordsProcessed || 0) + (r365.recordsProcessed || 0),
            details: `90d: ${(r90 as any).details || "done"}, 180d: ${(r180 as any).details || "done"}, 365d: ${(r365 as any).details || "done"}`,
          };
        },
      },
      {
        name: "cross-sell-outreach", // Proactive SMS from intelligence engine cross-sell patterns
        businessHoursOnly: true,
        handler: async () => {
          const { processCrossSellOutreach } = await import("./jobs/crossSellOutreach");
          return processCrossSellOutreach();
        },
      },
      {
        name: "warranty-alerts",
        handler: async () => {
          const { processWarrantyAlerts } = await import("./jobs/warrantyAlerts");
          return processWarrantyAlerts();
        },
      },
      {
        name: "declined-work-recovery",
        handler: async () => {
          const { getDeclinedWorkLedger } = await import("../services/declinedWorkRecovery");
          const ledger = await getDeclinedWorkLedger(20);

          // Actually ACT on declined work — alert on recoverable revenue
          const unrecovered = ledger.filter(e => e.declinedItems.some(i => !i.recovered));
          const totalRecoverableValue = unrecovered.reduce((sum, e) => sum + e.totalDeclinedValue, 0);
          const safetyItems = unrecovered.filter(e => e.hasSafetyItems);

          if (unrecovered.length > 0) {
            try {
              const { sendTelegram } = await import("../services/telegram");
              const { remember } = await import("../services/nickMemory");

              // Alert on safety-related declined work (highest priority)
              if (safetyItems.length > 0) {
                const topSafety = safetyItems.slice(0, 3);
                await sendTelegram(
                  `⚠️ DECLINED SAFETY WORK — ${safetyItems.length} customers\n\n` +
                  topSafety.map(e =>
                    `${e.customerName || "Customer"} (${e.phone || "no phone"}) — $${e.totalDeclinedValue} — ${e.vehicle}`
                  ).join("\n") +
                  `\n\nTotal recoverable: $${totalRecoverableValue}. Call them back.`
                );
              } else if (totalRecoverableValue > 500) {
                await sendTelegram(
                  `💰 DECLINED WORK: $${totalRecoverableValue} recoverable from ${unrecovered.length} customers.\n` +
                  `Top: ${unrecovered.slice(0, 2).map(e => `${e.customerName || "?"} ($${e.totalDeclinedValue})`).join(", ")}`
                );
              }

              await remember({
                type: "insight",
                content: `Declined work recovery: ${unrecovered.length} customers with $${totalRecoverableValue} recoverable. ${safetyItems.length} safety items.`,
                source: "declined_recovery",
                confidence: 0.85,
              });

              // AUTO-ENROLL declined customers into drip campaign (Gap 12 fix)
              const { enrollInDripCampaign } = await import("../services/workOrderAutomation");
              let enrolled = 0;
              for (const entry of unrecovered.slice(0, 10)) {
                if (entry.phone) {
                  try {
                    await enrollInDripCampaign("declined-estimate", {
                      phone: entry.phone,
                      name: entry.customerName || "there",
                      vehicle: entry.vehicle || undefined,
                      service: entry.declinedItems.map((i: any) => i.description || "service").join(", ").slice(0, 100),
                    });
                    enrolled++;
                  } catch {}
                }
              }
              if (enrolled > 0) log.info(`Enrolled ${enrolled} declined-estimate customers in drip`);
            } catch {}
          }

          return { recordsProcessed: ledger.length, details: `${unrecovered.length} unrecovered ($${totalRecoverableValue}), ${safetyItems.length} safety` };
        },
      },
      {
        name: "staff-performance",
        handler: async () => {
          const { getTeamPerformance } = await import("../services/staffPerformance");
          const perf = await getTeamPerformance();
          return { recordsProcessed: perf.techs?.length || 0, details: "Rollup complete" };
        },
      },
      {
        name: "fleet-scoring",
        handler: async () => {
          const { identifyFleetProspects } = await import("../services/fleetScoring");
          return identifyFleetProspects();
        },
      },
      {
        name: "review-monitor",
        requiresEnv: "GOOGLE_PLACES_API_KEY",
        handler: async () => {
          const { processReviewMonitor } = await import("./jobs/reviewMonitor");
          return processReviewMonitor();
        },
      },
      {
        name: "competitor-monitor",
        requiresEnv: "GOOGLE_PLACES_API_KEY",
        enabled: false,
        handler: async () => {
          const { fetchCompetitorSnapshot } = await import("../services/competitorMonitor");
          const data = await fetchCompetitorSnapshot();
          return { recordsProcessed: data.length, details: `${data.length} competitors` };
        },
      },
      // ─── NEW DAILY JOBS ────────────────────────────────
      {
        name: "churn-detection", // Detect at-risk customers and auto-enroll in drip
        handler: async () => {
          try {
            const { analyzeCustomers, getCustomerActionPlan } = await import("../services/customerIntelligence");
            const data = await analyzeCustomers();
            const plan = await getCustomerActionPlan();
            if (data.atRiskCustomers.length > 0) {
              const { sendTelegram } = await import("../services/telegram");
              await sendTelegram(
                `📉 DAILY CHURN CHECK\n\n` +
                `At-risk: ${data.atRiskCustomers.length} customers\n` +
                `Lapsed: ${data.lapsedCustomers} | Lost: ${data.lostCustomers}\n` +
                `Retention: ${data.retentionRate}%\n` +
                (plan ? `\n${plan.slice(0, 500)}` : "")
              );

              // AUTO-ENROLL at-risk customers into drip campaign (Gap 1+6 fix)
              const { enrollInDripCampaign } = await import("../services/workOrderAutomation");
              let enrolled = 0;
              for (const cust of data.atRiskCustomers.slice(0, 10)) {
                if (cust.phone) {
                  try {
                    await enrollInDripCampaign("at-risk", {
                      phone: cust.phone,
                      name: cust.name || "there",
                    });
                    enrolled++;
                  } catch {}
                }
              }
              if (enrolled > 0) log.info(`Enrolled ${enrolled} at-risk customers in drip`);
            }
            return { recordsProcessed: data.atRiskCustomers.length, details: `${data.atRiskCustomers.length} at-risk, ${data.retentionRate}% retention` };
          } catch { return { details: "Churn detection failed" }; }
        },
      },
      {
        name: "qc-comeback-detection", // Detect repeat visits = possible failed repair
        handler: async () => {
          try {
            const { getDb } = await import("../db");
            const d = await getDb();
            if (!d) return { details: "No DB" };
            const { workOrders } = await import("../../drizzle/schema");
            const { sql: sqlFn } = await import("drizzle-orm");
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            // Find work orders created in last 7 days where customer had a completed WO in prior 30 days
            const recentWOs = await d.select().from(workOrders)
              .where(sqlFn`${workOrders.createdAt} >= ${weekAgo}`)
              .limit(50);
            let comebacks = 0;
            for (const wo of recentWOs) {
              if (!wo.customerId) continue;
              const prior = await d.select().from(workOrders)
                .where(sqlFn`${workOrders.customerId} = ${wo.customerId} AND ${workOrders.id} != ${wo.id} AND ${workOrders.status} IN ('closed','invoiced','picked_up') AND ${workOrders.createdAt} >= ${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)}`)
                .limit(1);
              if (prior.length > 0) comebacks++;
            }
            if (comebacks > 0) {
              const { remember } = await import("../services/nickMemory");
              await remember({ type: "lesson", content: `QC comeback check: ${comebacks} potential comebacks this week (customers who returned within 30d of a completed job). Review quality.`, source: "qc_detection", confidence: 0.8 });
            }
            return { recordsProcessed: comebacks, details: `${comebacks} potential comebacks detected` };
          } catch { return { details: "QC comeback detection failed" }; }
        },
      },
      {
        name: "wo-auto-close", // Auto-close stale WOs in picked_up/invoiced >7 days
        handler: async () => {
          const { autoCloseStaleWorkOrders } = await import("../services/workOrderAutomation");
          return autoCloseStaleWorkOrders();
        },
      },
      {
        name: "estimate-followup", // Auto-follow up on unconverted estimates after 2-3 days
        handler: async () => {
          const { processEstimateFollowUp } = await import("../services/workOrderAutomation");
          return processEstimateFollowUp();
        },
      },
      {
        name: "gateway-price-refresh", // Auto-fetch wholesale tire prices from Gateway B2B
        requiresEnv: "GATEWAY_TIRE_USERNAME",
        handler: async () => {
          const { refreshGatewayPrices } = await import("../services/dataPipelines");
          return refreshGatewayPrices();
        },
      },
      {
        name: "invoice-cross-reconciliation", // Match invoices, flag anomalies, daily totals
        handler: async () => {
          const { crossReconcileInvoices } = await import("../services/dataPipelines");
          return crossReconcileInvoices();
        },
      },
      {
        name: "tire-inventory-intelligence", // Track popular sizes, low-stock alerts
        handler: async () => {
          const { analyzeTireInventory } = await import("../services/dataPipelines");
          return analyzeTireInventory();
        },
      },
      {
        name: "revenue-analytics-pipeline", // Week-over-week, monthly metrics, top services
        handler: async () => {
          const { processRevenueAnalytics } = await import("../services/dataPipelines");
          return processRevenueAnalytics();
        },
      },
      {
        name: "gbp-auto-post", // Generate and push GBP posts via Telegram (Gap 9 fix)
        handler: async () => {
          const { generateAndNotifyGBPPost } = await import("../services/gbpAutoPost");
          return generateAndNotifyGBPPost();
        },
      },
      {
        name: "email-campaign-auto", // Auto-send email campaigns via Resend (Gap 5 fix)
        handler: async () => {
          const { autoSendEmailCampaigns } = await import("../services/emailCampaigns");
          return autoSendEmailCampaigns();
        },
      },
      {
        name: "alg-auto-discovery", // Probe ShopDriver API for new endpoints
        handler: async () => {
          const { runAlgAutoDiscovery } = await import("./jobs/intelligenceAutopilot");
          return runAlgAutoDiscovery();
        },
      },
      {
        name: "revenue-reconciliation", // End-of-day revenue truth
        handler: async () => {
          try {
            const { getDailyRevenueTruth } = await import("../services/invoiceReconciliation");
            const truth = await getDailyRevenueTruth();
            const { remember } = await import("../services/nickMemory");
            await remember({
              type: "insight",
              content: `Daily revenue truth: $${truth.totalRevenue || 0}. Jobs: ${truth.completedJobs || 0}. Avg ticket: $${truth.avgTicket || 0}. This is the end-of-day verified number.`,
              source: "revenue_reconciliation",
              confidence: 0.95,
            });
            return { recordsProcessed: 1, details: `Revenue: $${truth.totalRevenue || 0}, ${truth.completedJobs || 0} jobs` };
          } catch { return { details: "Revenue reconciliation failed" }; }
        },
      },
    ],
    running: false,
    lastRun: null,
  });

  // ═══ TIER 5: BRIEFINGS (every 12 hr) ═══
  // Morning brief + daily report — timing-critical
  tiers.push({
    name: "briefings",
    intervalMs: 12 * 60 * 60 * 1000,
    jobs: [
      {
        name: "nick-morning-brief",
        handler: async () => {
          const { sendMorningBrief } = await import("./jobs/morningBrief");
          return sendMorningBrief();
        },
      },
      {
        name: "daily-report",
        handler: async () => {
          const { generateDailyReport } = await import("./jobs/dailyReport");
          return generateDailyReport();
        },
      },
      {
        name: "weather-intel",
        handler: async () => {
          const { checkWeatherTriggers } = await import("../services/weatherIntelligence");
          const result = await checkWeatherTriggers();
          return { recordsProcessed: result.triggered.length, details: result.details };
        },
      },
    ],
    running: false,
    lastRun: null,
  });

  // Start all tiers (staggered to avoid memory spike on boot)
  for (const tier of tiers) {
    const idx = tiers.indexOf(tier);
    // Only run heartbeat + pulse on startup. Daily/briefings wait for their interval.
    const runOnStartup = idx <= 1; // heartbeat + pulse only
    const stagger = idx * 30_000; // 30s between tiers (was 10s)

    if (runOnStartup) {
      setTimeout(() => {
        runTier(tier).catch(err => log.error(`Tier ${tier.name} startup failed:`, { error: err instanceof Error ? err.message : String(err) }));
      }, stagger);
    }

    // Schedule recurring
    tier.handle = setInterval(() => {
      runTier(tier).catch(err => log.error(`Tier ${tier.name} failed:`, { error: err instanceof Error ? err.message : String(err) }));
    }, tier.intervalMs);
  }

  log.info(`Tiered scheduler started: ${tiers.length} tiers, ${tiers.reduce((s, t) => s + t.jobs.length, 0)} jobs`);
}

/**
 * Stop the tiered scheduler.
 */
export function stopTieredScheduler(): void {
  for (const tier of tiers) {
    if (tier.handle) clearInterval(tier.handle);
  }
  log.info("Tiered scheduler stopped");
}

/**
 * Get tier statuses for admin dashboard.
 */
export function getTierStatuses(): Array<{ name: string; intervalMin: number; jobCount: number; running: boolean; lastRun: string | null }> {
  return tiers.map(t => ({
    name: t.name,
    intervalMin: Math.round(t.intervalMs / 60000),
    jobCount: t.jobs.length,
    running: t.running,
    lastRun: t.lastRun?.toISOString() || null,
  }));
}

/**
 * Run a single tier job by name. Searches all tiers.
 */
export async function runTierJobByName(jobName: string): Promise<{ status: string; recordsProcessed?: number; details?: string }> {
  for (const tier of tiers) {
    const job = tier.jobs.find(j => j.name === jobName);
    if (job) {
      try {
        const result = await job.handler();
        return { status: "completed", recordsProcessed: result.recordsProcessed, details: result.details };
      } catch (err) {
        return { status: "failed", details: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  const allNames = tiers.flatMap(t => t.jobs.map(j => j.name));
  return { status: "not_found", details: `Job "${jobName}" not found. Available: ${allNames.join(", ")}` };
}
