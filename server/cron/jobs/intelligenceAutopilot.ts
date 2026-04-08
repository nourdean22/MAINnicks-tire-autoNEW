/**
 * Intelligence Autopilot — The system's autonomous brain
 *
 * Runs every 2 hours during business hours. Analyzes all intelligence
 * engines and takes autonomous action:
 *
 * 1. Revenue pacing — alerts if behind/ahead of $20K monthly target
 * 2. Lead scoring — auto re-scores all open leads, alerts on hot ones
 * 3. Cross-sell discovery — finds high-value opportunities, alerts top 3
 * 4. LTV shifts — detects VIP customers at risk of churn
 * 5. Bottleneck detection — alerts on operational slowdowns
 * 6. Campaign attribution — tracks what's actually working
 *
 * All findings go to Telegram + Nick's memory. The system learns and acts
 * without anyone clicking a button.
 */
import { createLogger } from "../../lib/logger";
import { BUSINESS } from "@shared/business";

const log = createLogger("cron:intelligence-autopilot");

const MONTHLY_TARGET = BUSINESS.revenueTarget.monthly;

export async function runIntelligenceAutopilot(): Promise<{ recordsProcessed: number; details?: string }> {
  const alerts: string[] = [];
  let actionsPerformed = 0;

  try {
    const {
      forecastRevenue,
      generateCrossSellRecommendations,
      scoreLeads,
      predictCustomerLTV,
      analyzeBottlenecks,
      analyzeDeclinedWork,
    } = await import("../../services/intelligenceEngines");

    // ── 1. Revenue Pacing ──────────────────────────────────
    try {
      const forecast = await forecastRevenue();
      const dayOfMonth = new Date().getDate();
      const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
      const expectedPace = (dayOfMonth / daysInMonth) * MONTHLY_TARGET;
      const monthRevenue = forecast.month?.soFar || 0;
      const pacePercent = expectedPace > 0 ? Math.round((monthRevenue / expectedPace) * 100) : 0;

      if (pacePercent < 80 && dayOfMonth >= 5) {
        alerts.push(`📉 REVENUE BEHIND: $${Math.round(monthRevenue).toLocaleString()} vs $${Math.round(expectedPace).toLocaleString()} expected (${pacePercent}% pace). Need $${Math.round(MONTHLY_TARGET - monthRevenue).toLocaleString()} more this month.`);
      } else if (pacePercent > 120) {
        alerts.push(`🔥 REVENUE AHEAD: $${Math.round(monthRevenue).toLocaleString()} — ${pacePercent}% of pace. On track to beat $${MONTHLY_TARGET.toLocaleString()} target.`);
      }

      // ── Auto-corrective revenue actions ─────────────────
      // Escalating actions based on how far behind pace
      const { isEnabled: isRevCorrectionEnabled } = await import("../../services/featureFlags");
      const revCorrectionOn = await isRevCorrectionEnabled("auto_revenue_correction");
      if (revCorrectionOn && pacePercent < 80 && dayOfMonth >= 10) {
        // 10+ days into month and behind 80% pace → trigger winback batch
        try {
          const { processWinbackPending } = await import("../../services/winbackProcessor");
          await processWinbackPending();
          alerts.push(`🚨 AUTO-RECOVERY: Triggered winback batch (revenue ${pacePercent}% of pace)`);
        } catch (e) { console.warn("[jobs/intelligenceAutopilot] operation failed:", e); }
      }
      if (revCorrectionOn && pacePercent < 60 && dayOfMonth >= 15) {
        // 15+ days in and behind 60% → generate emergency recommendations
        try {
          const { sendTelegram } = await import("../../services/telegram");
          await sendTelegram(
            `🔴 REVENUE EMERGENCY: ${pacePercent}% of pace at day ${dayOfMonth}.\n\n` +
            `RECOMMENDED ACTIONS:\n` +
            `1. Post a flash special on GBP (20% off oil changes this week)\n` +
            `2. Send SMS blast to lapsed 90+ day customers\n` +
            `3. Activate referral bonus double-up ($50 instead of $25)\n` +
            `4. Push tire sale on social media`
          );
        } catch (e) { console.warn("[jobs/intelligenceAutopilot] operation failed:", e); }
      }

      // Today's revenue check
      const todayRevenue = forecast.today?.soFar || 0;
      const dailyTarget = MONTHLY_TARGET / daysInMonth;
      if (todayRevenue > dailyTarget * 1.5) {
        alerts.push(`💰 Big day: $${Math.round(todayRevenue).toLocaleString()} today (${Math.round((todayRevenue / dailyTarget) * 100)}% of daily target)`);
      }
    } catch (e: unknown) {
      log.warn("Revenue forecast failed:", { error: (e as Error).message });
    }

    // ── 2. Auto Lead Scoring ───────────────────────────────
    try {
      const scored = await scoreLeads();
      actionsPerformed += scored.length;

      // Alert on hot leads (score >= 70)
      type ScoredLead = typeof scored[number];
      const hotLeads = scored.filter((l: ScoredLead) => l.score >= 70);
      if (hotLeads.length > 0) {
        const topLeads = hotLeads.slice(0, 3);
        alerts.push(
          `🎯 ${hotLeads.length} HOT LEAD${hotLeads.length > 1 ? "S" : ""}: ` +
          topLeads.map((l: ScoredLead) => `${l.name || "Unknown"} (score: ${l.score}, ${l.service || "general"})`).join(" | ")
        );
      }
    } catch (e: unknown) {
      log.warn("Lead scoring failed:", { error: (e as Error).message });
    }

    // ── 3. Cross-Sell Opportunities ────────────────────────
    try {
      const { recommendations, patterns } = await generateCrossSellRecommendations();
      type CrossSellRec = typeof recommendations[number];
      const overdue = recommendations.filter((r: CrossSellRec) => r.urgency === "overdue");
      const totalValue = overdue.reduce((sum: number, r: CrossSellRec) => sum + ((r as Record<string, unknown>).estimatedValue as number || 0), 0);

      if (overdue.length >= 3 && totalValue > 200) {
        alerts.push(
          `🔗 ${overdue.length} CROSS-SELL OVERDUE (~$${Math.round(totalValue)}): ` +
          overdue.slice(0, 3).map((r: CrossSellRec) => `${(r.name || "Customer").split(" ")[0]} needs ${r.service}`).join(", ")
        );
      }

      // Pattern insights
      const strongPatterns = (patterns || []).filter((p: typeof patterns[number]) => (p as Record<string, unknown>).confidence as number >= 0.6);
      if (strongPatterns.length > 0) {
        actionsPerformed += strongPatterns.length;
      }
    } catch (e: unknown) {
      log.warn("Cross-sell analysis failed:", { error: (e as Error).message });
    }

    // ── 4. LTV & Churn Risk ────────────────────────────────
    try {
      const ltv = await predictCustomerLTV();
      const atRisk = ltv.atRiskHighValue || [];

      if (atRisk.length > 0) {
        alerts.push(
          `⚠️ ${atRisk.length} HIGH-VALUE CUSTOMER${atRisk.length > 1 ? "S" : ""} AT RISK: ` +
          atRisk.slice(0, 3).map((c: typeof atRisk[number]) => `${c.name || "?"} (LTV score: ${c.ltvScore || 0}, ${c.daysSinceLastVisit || "?"}d since visit)`).join(", ") +
          `. Reach out NOW.`
        );
      }
    } catch (e: unknown) {
      log.warn("LTV prediction failed:", { error: (e as Error).message });
    }

    // ── 4b. Churn Prediction ─────────────────────────────────
    try {
      const { predictChurn } = await import("../../services/intelligenceEngines");
      const churn = await predictChurn();
      actionsPerformed += (churn.highRisk.length + churn.mediumRisk.length);

      if (churn.highRisk.length > 0) {
        const topRisk = churn.highRisk.slice(0, 5);
        alerts.push(
          `🚨 ${churn.highRisk.length} CHURN RISK (>70%): ` +
          topRisk.map(c => `${c.name} (${c.churnProbability}%, ${c.daysSinceVisit}d ago)`).join(" | ") +
          `. Reach out NOW before they go to a competitor.`
        );
      }
    } catch (e: unknown) {
      log.warn("Churn prediction failed:", { error: (e as Error).message });
    }

    // ── 5. Bottleneck Detection ────────────────────────────
    try {
      const bottlenecks = await analyzeBottlenecks();
      if (bottlenecks.bottleneck) {
        alerts.push(
          `🚧 BOTTLENECK: "${bottlenecks.bottleneck.stage}" stage averaging ${Math.round(bottlenecks.bottleneck.avgHours)}h. ` +
          `Completion rate: ${bottlenecks.completionRate}% across ${bottlenecks.totalBookings} recent bookings.`
        );
      }
    } catch (e: unknown) {
      log.warn("Bottleneck analysis failed:", { error: (e as Error).message });
    }

    // ── 6. Declined Work Recovery ──────────────────────────
    try {
      const declined = await analyzeDeclinedWork();
      const recoverable = declined.totalDeclinedValue || 0;

      if (recoverable > 500) {
        alerts.push(
          `💸 $${Math.round(recoverable)} DECLINED WORK recoverable from ${declined.totalWithDeclined || "?"} customers. ` +
          `Top services: ${(declined.topDeclinedServices || []).slice(0, 2).map((s: [string, { count: number; totalValue: number }]) => `${s[0]} ($${Math.round(s[1].totalValue)})`).join(", ")}`
        );
      }
    } catch (e: unknown) {
      log.warn("Declined work analysis failed:", { error: (e as Error).message });
    }

    // ── 7. Walk-in vs Website Classification ────────────────
    try {
      const { getDb } = await import("../../db");
      const { sql: rawSql } = await import("drizzle-orm");
      const d = await getDb();
      if (d) {
        // Count today's invoices
        const [invoiceRows] = await d.execute(rawSql`
          SELECT COUNT(*) as total FROM invoices
          WHERE invoiceDate >= CURDATE() AND paymentStatus = 'paid'
        `);
        type RawRow = Record<string, unknown>;
        const todayInvoices = Number((invoiceRows as RawRow[])?.[0]?.total || 0);

        // Count today's website bookings
        const [bookingRows] = await d.execute(rawSql`
          SELECT COUNT(*) as total FROM bookings
          WHERE createdAt >= CURDATE() AND status IN ('confirmed', 'completed')
        `);
        const todayBookings = Number((bookingRows as RawRow[])?.[0]?.total || 0);

        const walkIns = Math.max(0, todayInvoices - todayBookings);
        if (todayInvoices > 0) {
          const walkInPct = Math.round((walkIns / todayInvoices) * 100);
          alerts.push(
            `🚶 TODAY: ${todayInvoices} jobs — ${walkIns} walk-ins (${walkInPct}%), ${todayBookings} from website. FCFS working.`
          );
        }

        // Count free inspections (invoices with $0 or very low amount)
        const [freeRows] = await d.execute(rawSql`
          SELECT COUNT(*) as total FROM invoices
          WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            AND totalAmount <= 500
            AND paymentStatus = 'paid'
        `);
        const freeInspections = Number((freeRows as RawRow[])?.[0]?.total || 0);
        if (freeInspections > 0) {
          // Don't alert — these are intentional. Just track.
          actionsPerformed += freeInspections;
        }

        // Estimate-to-invoice conversion (ALG estimates = declined work)
        const [estRows] = await d.execute(rawSql`
          SELECT
            COUNT(CASE WHEN paymentStatus = 'pending' AND invoiceDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 END) as estimates,
            COUNT(CASE WHEN paymentStatus = 'paid' AND invoiceDate >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 END) as closed
          FROM invoices
        `);
        const estimates = Number((estRows as RawRow[])?.[0]?.estimates || 0);
        const closed = Number((estRows as RawRow[])?.[0]?.closed || 0);
        if (estimates > 3) {
          const conversionRate = closed > 0 ? Math.round((closed / (closed + estimates)) * 100) : 0;
          alerts.push(
            `📋 DECLINED ESTIMATES: ${estimates} pending (walked away) vs ${closed} closed this week. ${conversionRate}% close rate.`
          );
        }
      }
    } catch (e: unknown) {
      log.warn("Walk-in classification failed:", { error: (e as Error).message });
    }

    // ── Compute health score inline (avoids re-running all 28 engines via master report) ──
    const healthScore = Math.max(0, 100 - alerts.length * 10);

    // ── Send Alerts ────────────────────────────────────────
    if (alerts.length > 0) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });

        await sendTelegram(
          `🧠 INTELLIGENCE AUTOPILOT — ${now}${healthScore ? ` | Health: ${healthScore}/100` : ""}\n\n` +
          alerts.join("\n\n") +
          `\n\n📊 ${actionsPerformed} records analyzed`
        );
      } catch (e: unknown) {
        log.warn("Telegram alert failed:", { error: (e as Error).message });
      }

      // Store to Nick's memory
      try {
        const { remember } = await import("../../services/nickMemory");
        await remember({
          type: "insight",
          content: `Intelligence autopilot: ${alerts.length} findings. ${alerts.join(" | ").slice(0, 1500)}`,
          source: "intelligence_autopilot",
          confidence: 0.85,
        });
      } catch (e) { console.warn("[jobs/intelligenceAutopilot] operation failed:", e); }
    }

    const details = `${alerts.length} alerts, ${actionsPerformed} records analyzed`;
    if (alerts.length > 0) log.info(`Autopilot: ${details}`);
    return { recordsProcessed: actionsPerformed, details };
  } catch (err: unknown) {
    log.error("Intelligence autopilot failed:", { error: (err as Error).message });
    return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` };
  }
}

/**
 * ALG Auto-Discovery — probes ShopDriver API for new endpoints weekly.
 * Alerts via Telegram if any new live endpoints are found.
 */
export async function runAlgAutoDiscovery(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { probeAlgEndpoints } = await import("../../services/shopDriverMirror");
    const resultMap = await probeAlgEndpoints();
    const entries = Object.entries(resultMap);
    const total = entries.length;

    const live = entries.filter(([, r]) => r.status >= 200 && r.status < 400);
    const withData = entries.filter(([, r]) => r.isJson && r.sampleSize > 10);

    if (live.length > 0) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(
          `🔍 ALG DISCOVERY: ${live.length}/${total} endpoints responding\n\n` +
          live.slice(0, 5).map(([endpoint, r]) => `${endpoint}: HTTP ${r.status} ${r.isJson ? "(JSON)" : "(other)"} ${r.sampleSize}b`).join("\n") +
          (withData.length > 0 ? `\n\n${withData.length} endpoints returning usable JSON data` : "")
        );
      } catch (e) { console.warn("[jobs/intelligenceAutopilot] operation failed:", e); }
    }

    // Store discovery results
    try {
      const { remember } = await import("../../services/nickMemory");
      await remember({
        type: "insight",
        content: `ALG API probe: ${live.length}/${total} endpoints live. ${withData.length} with JSON data. Endpoints: ${live.map(([e]) => e).join(", ")}`,
        source: "alg_discovery",
        confidence: 0.9,
      });
    } catch (e) { console.warn("[jobs/intelligenceAutopilot] operation failed:", e); }

    return { recordsProcessed: total, details: `${live.length} live, ${withData.length} with data` };
  } catch (err: unknown) {
    log.error("ALG discovery failed:", { error: (err as Error).message });
    return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` };
  }
}
