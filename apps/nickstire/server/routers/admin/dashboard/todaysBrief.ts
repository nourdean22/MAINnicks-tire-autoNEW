/**
 * Morning brief composition — the 3-line what-changed-overnight summary.
 *
 * Carved from admin/dashboard.ts (1,133 lines, one router object holding
 * 17 procedures) in the 2026-07-05 polish wave. Grouped by reason-to-change.
 * Each group is a plain procedure record; ./index.ts spread-merges them into
 * one flat router, so every adminDashboard.<proc> client call path is
 * byte-identical. Pure mechanical move — no procedure body was modified.
 */
/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure } from "../../../_core/trpc";


import { createLogger } from "../../../lib/logger";

const log = createLogger("routers:admin");


export const todaysBriefProcedures = {
  todaysBrief: adminProcedure.query(async () => {
    const briefs: Array<{
      id: string;
      variant: "primary" | "warning" | "danger" | "info" | "success";
      icon: string;
      message: string;
      metric: string;
      cta: { label: string; section: string; settingsTab?: string };
      score: number;
    }> = [];

    try {
      const { getDb } = await import("../../../db");
      const d = await getDb();
      if (!d) return { briefs: [], generatedAt: new Date().toISOString() };

      const { callbackRequests, leads, bookings, algEstimates, reviewReplies, specials } = await import("../../../../drizzle/schema");
      const { sql, eq, and, gte, lte, isNull } = await import("drizzle-orm");

      // 1. Pending callbacks (highest urgency — every minute = lost trust)
      try {
        const cb = await d
          .select({ count: sql<number>`count(*)` })
          .from(callbackRequests)
          .where(sql`${callbackRequests.status} IN ('new', 'pending')`);
        const cbCount = Number(cb[0]?.count || 0);
        if (cbCount > 0) {
          briefs.push({
            id: "callbacks",
            variant: "danger",
            icon: "phone",
            message: `Customers waiting for a call back. Every hour drops conversion ~10%.`,
            metric: `${cbCount} callback${cbCount === 1 ? "" : "s"} pending`,
            cta: { label: "Call them", section: "callTrackingView" },
            score: 100 + cbCount * 5,
          });
        }
      } catch (e) { log.warn("[todaysBrief] callbacks check failed", { error: e instanceof Error ? e.message : String(e) }); }

      // 2. Fresh leads in golden response window (<4h)
      try {
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
        const fl = await d
          .select({ count: sql<number>`count(*)` })
          .from(leads)
          .where(and(
            eq(leads.status, "new"),
            gte(leads.createdAt, fourHoursAgo),
          ));
        const flCount = Number(fl[0]?.count || 0);
        if (flCount > 0) {
          briefs.push({
            id: "fresh_leads",
            variant: "warning",
            icon: "users",
            message: `Fresh leads under 4 hours old — close them before they shop around.`,
            metric: `${flCount} hot lead${flCount === 1 ? "" : "s"}`,
            cta: { label: "Open Leads", section: "leads" },
            score: 90 + flCount * 3,
          });
        }
      } catch (e) { log.warn("[todaysBrief] fresh leads check failed", { error: e instanceof Error ? e.message : String(e) }); }

      // 3. Walk-away ALG estimates with high $
      try {
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const wa = await d
          .select({
            count: sql<number>`count(*)`,
            total: sql<number>`COALESCE(SUM(${algEstimates.estimatedAmount}), 0)`,
          })
          .from(algEstimates)
          .where(and(
            isNull(algEstimates.matchedInvoiceId),
            gte(algEstimates.estimateDate, sixtyDaysAgo),
          ));
        const waCount = Number(wa[0]?.count || 0);
        const waTotal = Math.round(Number(wa[0]?.total || 0) / 100);
        if (waCount >= 3 && waTotal >= 500) {
          briefs.push({
            id: "walkaway",
            variant: "primary",
            icon: "dollar",
            message: `Walked-away estimates from last 60 days. SMS recovery cron targets these (currently DRY-RUN — set env flag).`,
            metric: `$${waTotal.toLocaleString()} on the table`,
            cta: { label: "Open Declined Work", section: "declinedEstimates" },
            score: 80 + Math.min(20, Math.round(waTotal / 100)),
          });
        }
      } catch (e) { log.warn("[todaysBrief] walk-away estimates check failed", { error: e instanceof Error ? e.message : String(e) }); }

      // 4. Negative reviews needing response (last 7d, ≤2 stars)
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const neg = await d
          .select({ count: sql<number>`count(*)` })
          .from(reviewReplies)
          .where(and(
            lte(reviewReplies.reviewRating, 2),
            gte(reviewReplies.reviewDate, sevenDaysAgo),
            sql`(${reviewReplies.status} IS NULL OR ${reviewReplies.status} IN ('draft', 'pending'))`,
          ));
        const negCount = Number(neg[0]?.count || 0);
        if (negCount > 0) {
          briefs.push({
            id: "neg_reviews",
            variant: "danger",
            icon: "star",
            message: `Negative reviews waiting for response. Public response within 24h preserves trust score.`,
            metric: `${negCount} review${negCount === 1 ? "" : "s"} pending`,
            cta: { label: "Open Re-engagement", section: "reEngagement" },
            score: 95 + negCount * 5,
          });
        }
      } catch (e) { log.warn("[todaysBrief] negative reviews check failed", { error: e instanceof Error ? e.message : String(e) }); }

      // 5. Bookings today that haven't been confirmed
      try {
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
        const tb = await d
          .select({ count: sql<number>`count(*)` })
          .from(bookings)
          .where(and(
            sql`${bookings.preferredDate} BETWEEN ${todayStart} AND ${todayEnd}`,
            eq(bookings.status, "new"),
          ));
        const tbCount = Number(tb[0]?.count || 0);
        if (tbCount > 0) {
          briefs.push({
            id: "today_bookings",
            variant: "warning",
            icon: "calendar",
            message: `Bookings dropping in today still unconfirmed. Confirm to lock the slot + reduce no-shows.`,
            metric: `${tbCount} booking${tbCount === 1 ? "" : "s"} unconfirmed`,
            cta: { label: "Open Dashboard", section: "overview" },
            score: 85 + tbCount * 4,
          });
        }
      } catch (e) { log.warn("[todaysBrief] today bookings check failed", { error: e instanceof Error ? e.message : String(e) }); }

      // 6. Specials expiring within 3 days
      try {
        const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        const exp = await d
          .select({
            id: specials.id,
            title: specials.title,
            expiresAt: specials.expiresAt,
          })
          .from(specials)
          .where(and(
            eq(specials.isActive, true),
            sql`${specials.expiresAt} IS NOT NULL`,
            sql`${specials.expiresAt} <= ${threeDaysFromNow}`,
            sql`${specials.expiresAt} > NOW()`,
          ))
          .limit(3);
        if (exp.length > 0) {
          briefs.push({
            id: "specials_expiring",
            variant: "info",
            icon: "tag",
            message: `Active special${exp.length === 1 ? "" : "s"} expiring soon: ${exp.map((s: { title: string }) => s.title).join(", ")}. Renew or replace.`,
            metric: `${exp.length} expiring`,
            cta: { label: "Open Content", section: "content" },
            score: 50 + exp.length * 2,
          });
        }
      } catch (e) { log.warn("[todaysBrief] expiring specials check failed", { error: e instanceof Error ? e.message : String(e) }); }

      // Sort by score (highest urgency first), cap at 5
      briefs.sort((a, b) => b.score - a.score);
      return {
        briefs: briefs.slice(0, 5),
        totalFlagged: briefs.length,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      // Never crash the UI — return empty briefs on error
      return {
        briefs: [],
        totalFlagged: 0,
        generatedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : "Failed to compute brief",
      };
    }
  }),

  /**
   * Section Insight — single actionable callout for a specific admin
   * section. Returns the highest-priority signal RELEVANT TO THAT SECTION,
   * not the global Today's Brief.
   *
   * Used by the InsightStrip primitive at the top of each section so
   * Nour sees "for Customers: 12 lapsed VIPs need outreach" or "for
   * Revenue: MTD pace is 8% behind".
   *
   * Returns null when no actionable signal — section just renders no strip.
   */
};
