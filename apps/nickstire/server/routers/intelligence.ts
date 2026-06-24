/**
 * Intelligence Router — live admin-dashboard analytics surface.
 *
 * Trimmed to the procedures with real client consumers. The engine/analyzer
 * service functions themselves remain in server/services/** (the cron
 * autopilot calls them directly) — only the unused tRPC wrappers were removed.
 */
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { intelligenceDecisionLedger } from "../../drizzle/schema";
import { forecastSeasonalDemand } from "../services/intelligenceEngines";
import { generateMasterIntelligenceReport } from "../services/masterIntelligence";
import {
  buildServiceAffinityMap,
  analyzeContentPerformance,
  analyzeCompetitorGap,
  analyzeChatFunnel,
} from "../services/advancedEngines";

import { safeCount, safeRowQuery } from "../lib/sql-safe";

export const intelligenceRouter = router({
  /** #6 Seasonal Demand Forecasting — which services peak this month */
  seasonalDemand: adminProcedure.query(async () => {
    return forecastSeasonalDemand();
  }),

  /** #21 Service Affinity Map */
  serviceAffinity: adminProcedure.query(async () => buildServiceAffinityMap()),

  /** #33 Content Performance */
  contentPerformance: adminProcedure.query(async () => analyzeContentPerformance()),

  /** #34 Competitor Gap Analysis */
  competitorGap: adminProcedure.query(async () => analyzeCompetitorGap()),

  /** #44 Chat Conversion Funnel */
  chatFunnel: adminProcedure.query(async () => analyzeChatFunnel()),

  /** Master Intelligence Report — unified digest across all 50 engines */
  masterReport: adminProcedure.query(async () => {
    return generateMasterIntelligenceReport();
  }),

  // ── Next Best Actions — prioritized operator queue ──
  nextBestActions: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { sql: rawSql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { actions: [] };

    type Action = {
      type: "hot_lead" | "pending_invoice" | "callback" | "vip_winback";
      message: string;
      urgency: number;
      actionUrl: string;
      phone: string | null;
    };

    const actions: Action[] = [];

    // 1. Hot leads — new leads with urgency >= 3. Callback-linked duplicate
    // leads (source=callback AND callbackId set) are excluded: the same
    // person already surfaces via the callback branch below, and listing
    // both made one caller two "do now" actions. Voice rack-check leads
    // (callbackId NULL) keep counting. See shared/leadSource.ts.
    type HotLead = { id: number; name: string | null; phone: string | null; urgencyScore: number; source: string | null };
    const hotLeads = await safeRowQuery<HotLead>(d,
      rawSql`SELECT id, name, phone, urgencyScore, source FROM leads WHERE status = 'new' AND urgencyScore >= 3 AND NOT (source = 'callback' AND callbackId IS NOT NULL) ORDER BY urgencyScore DESC, createdAt ASC LIMIT 10`
    );
    for (const l of hotLeads) {
      // Display-only clamp (wave-187 UrgencyBadge precedent): legacy rows
      // store out-of-range urgencyScores (e.g. 34, 42) from before capture
      // clamping — raw render produced nonsense like "34/5 urgency".
      const displayScore = Math.min(5, Math.max(1, l.urgencyScore));
      actions.push({
        type: "hot_lead",
        message: `Call ${l.name || "Unknown"} — hot lead (${displayScore}/5 urgency, ${l.source || "direct"})`,
        urgency: Math.min(5, displayScore + 1),
        actionUrl: "/admin?tab=leads",
        phone: l.phone || null,
      });
    }


    // 3. Callbacks unanswered > 2 hours
    type Callback = { id: number; name: string | null; phone: string | null; context: string | null; createdAt: string | Date };
    const callbacks = await safeRowQuery<Callback>(d,
      rawSql`SELECT id, name, phone, context, createdAt FROM callback_requests WHERE status = 'new' AND (sourcePage IS NULL OR sourcePage <> 'voice-forwarded') AND createdAt < DATE_SUB(NOW(), INTERVAL 2 HOUR) ORDER BY createdAt ASC LIMIT 8`
    );
    for (const cb of callbacks) {
      const hoursAgo = Math.round((Date.now() - new Date(cb.createdAt).getTime()) / 3600000);
      actions.push({
        type: "callback",
        message: `Call back ${cb.name || "Unknown"} — waiting ${hoursAgo}h`,
        urgency: hoursAgo > 8 ? 5 : hoursAgo > 4 ? 4 : 3,
        actionUrl: "/admin?tab=callbacks",
        phone: cb.phone || null,
      });
    }

    // 4. VIP customers going cold (3+ visits, 60+ days since last visit)
    type VipCustomer = { id: number; firstName: string | null; lastName: string | null; phone: string | null; totalVisits: number; lastVisitDate: string | Date | null; daysSince: number };
    const vipCold = await safeRowQuery<VipCustomer>(d,
      rawSql`SELECT id, firstName, lastName, phone, totalVisits, lastVisitDate, DATEDIFF(NOW(), lastVisitDate) as daysSince FROM customers WHERE totalVisits >= 3 AND lastVisitDate < DATE_SUB(NOW(), INTERVAL 60 DAY) AND lastVisitDate IS NOT NULL ORDER BY totalVisits DESC, lastVisitDate ASC LIMIT 8`
    );
    for (const c of vipCold) {
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown";
      actions.push({
        type: "vip_winback",
        message: `Re-engage ${name} — VIP (${c.totalVisits} visits), ${c.daysSince}d since last visit`,
        urgency: c.daysSince > 180 ? 4 : 3,
        actionUrl: "/admin?tab=customers",
        phone: c.phone || null,
      });
    }

    // Sort by urgency desc, take top 8
    actions.sort((a, b) => b.urgency - a.urgency);
    return { actions: actions.slice(0, 8) };
  }),

  // ── Shop Load (real-time) ──
  //
  // "Cars in Shop" = work orders that are ACTUALLY being worked on right
  // now. Two filters protect against phantom counts:
  //
  //  1. Status: only `in_progress`, `waiting_parts`, `quality_check` count.
  //     `approved` was previously included but it's a QUOTE-stage status —
  //     a quote can sit in `approved` for weeks without the car ever being
  //     in the shop. Including it produced phantoms (e.g. WO-2026-105165
  //     was "approved" for 18 days with no vehicle info, never started).
  //
  //  2. Freshness: ignore anything whose updated_at is older than 7 days.
  //     A WO that hasn't been touched in a week is dead, not active.
  //     If a job genuinely takes a week+, the tech updates it.
  shopLoad: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { sql: rawSql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { activeWOs: 0, todayBookings: 0, estimatedWait: 0 };
    const activeWOs = await safeCount(d, rawSql`
      SELECT COUNT(*) as cnt FROM work_orders
      WHERE status IN ('in_progress', 'waiting_parts', 'quality_check')
        AND COALESCE(updated_at, created_at) >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    const todayBookings = await safeCount(d,
      rawSql`SELECT COUNT(*) as cnt FROM bookings WHERE createdAt >= CURDATE() AND status IN ('new', 'confirmed')`
    );
    return { activeWOs, todayBookings, estimatedWait: activeWOs === 0 ? 0 : Math.min(180, activeWOs * 45) };
  }),

  // ── Decision Ledger & Learning Loop ──
  logDecision: adminProcedure
    .input(z.object({
      engineId: z.string(),
      recommendationType: z.string(),
      recommendationTarget: z.string(),
      actionTaken: z.string(),
      valueAtRiskCents: z.number().optional().default(0),
      contextJson: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) throw new Error("DB not ready");

      await d.insert(intelligenceDecisionLedger).values({
        engineId: input.engineId,
        recommendationType: input.recommendationType,
        recommendationTarget: input.recommendationTarget,
        actionTaken: input.actionTaken,
        valueAtRiskCents: input.valueAtRiskCents,
        contextJson: input.contextJson,
      });
      return { success: true };
    }),

  updateDecisionOutcome: adminProcedure
    .input(z.object({
      id: z.number(),
      actualRevenueCapturedCents: z.number(),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) throw new Error("DB not ready");

      await d.update(intelligenceDecisionLedger)
        .set({ actualRevenueCapturedCents: input.actualRevenueCapturedCents })
        .where(eq(intelligenceDecisionLedger.id, input.id));
      return { success: true };
    }),

  recentDecisions: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return [];

    return await d.select().from(intelligenceDecisionLedger).orderBy(desc(intelligenceDecisionLedger.createdAt)).limit(20);
  }),
});
