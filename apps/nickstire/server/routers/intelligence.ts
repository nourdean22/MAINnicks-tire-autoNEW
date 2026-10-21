/**
 * Intelligence Router — live admin-dashboard analytics surface.
 *
 * Trimmed to the procedures with real client consumers. The engine/analyzer
 * service functions themselves remain in server/services/** (the cron
 * autopilot calls them directly) — only the unused tRPC wrappers were removed.
 */
import { adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { desc } from "drizzle-orm";
import { intelligenceDecisionLedger, socialContentInventory } from "../../drizzle/schema";
import { forecastSeasonalDemand } from "../services/intelligenceEngines";
import { generateMasterIntelligenceReport } from "../services/masterIntelligence";
import {
  buildServiceAffinityMap,
  analyzeContentPerformance,
  analyzeCompetitorGap,
  analyzeChatFunnel,
} from "../services/advancedEngines";

import { safeRowQuery } from "../lib/sql-safe";

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
  // A failed read is an error, not an empty funnel: the AI Ideas page then says
  // "(not read)" instead of counting it as a payload with no topics.
  chatFunnel: adminProcedure.query(async () => {
    const funnel = await analyzeChatFunnel();
    if (funnel.unavailable) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "chat funnel read failed: unknown, not empty" });
    }
    return funnel;
  }),

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

  recentDecisions: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return [];

    return await d.select().from(intelligenceDecisionLedger).orderBy(desc(intelligenceDecisionLedger.createdAt)).limit(20);
  }),

  contentDrafts: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return [];

    return await d.select().from(socialContentInventory).orderBy(desc(socialContentInventory.createdAt)).limit(50);
  }),
});
