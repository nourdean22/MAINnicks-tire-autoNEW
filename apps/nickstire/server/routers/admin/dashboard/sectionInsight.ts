/**
 * Per-section insight strips (SectionInsightStrip data source).
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
import { z } from "zod";
import { inArray } from "drizzle-orm";





export const sectionInsightProcedures = {
  // Read-only repeat-customer retention cohorts (one-and-done vs repeat,
  // reactivation-eligible). Powers the customers-section insight below and any
  // retention panel. NOTHING on the SMS send path.
  retentionCohortSummary: adminProcedure.query(async () => {
    try {
      const { getRetentionCohortSummary } = await import("../../../lib/retentionCohorts");
      return await getRetentionCohortSummary();
    } catch (e) {
      void e;
      return null;
    }
  }),
  sectionInsight: adminProcedure
    .input(z.object({
      section: z.enum([
        "customers", "revenue", "leads", "campaigns", "callTrackingView",
        "declinedEstimates", "noShowRisk", "reEngagement", "content",
        "intelligence", "settings", "trafficFunnel", "snapDashboard",
      ]),
    }))
    .query(async ({ input }) => {
      try {
        const { getDb } = await import("../../../db");
        const d = await getDb();
        if (!d) return null;
        const { sql, eq, and, gte, isNull } = await import("drizzle-orm");

        switch (input.section) {
          case "customers": {
            // Lapsed VIP customers — high LTV, haven't visited in 6+ months
            try {
              const { customers } = await import("../../../../drizzle/schema");
              const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
              const [vipLapsed] = await d
                .select({ count: sql<number>`count(*)` })
                .from(customers)
                .where(and(
                  sql`${customers.totalSpent} >= 50000`, // $500+ lifetime spend (cents)
                  sql`${customers.lastVisitDate} < ${sixMonthsAgo}`,
                ));
              const cnt = Number(vipLapsed?.count || 0);
              if (cnt >= 3) {
                return {
                  variant: "primary" as const,
                  message: `Lapsed VIPs (>$500 lifetime, no visit in 6+ months) — these are your highest-LTV winback targets.`,
                  metric: `${cnt} VIPs lapsed`,
                  cta: { label: "Run Win-Back", section: "reEngagement" },
                };
              }
            } catch (e) { void e; }
            // Retention overview — the fundamental repeat-customer lens, shown
            // when there's no lapsed-VIP alert to surface. Read-only.
            try {
              const { getRetentionCohortSummary } = await import("../../../lib/retentionCohorts");
              const c = await getRetentionCohortSummary();
              // MIN_COHORT_SAMPLE (20): below this the percentages are noise.
              if (c && c.customersWithVisits >= 20 && c.oneAndDone.count > 0) {
                const winbackUsd = Math.round(c.reactivationEligible.lifetimeValueCents / 100);
                return {
                  variant: "primary" as const,
                  message: `${c.oneAndDone.pct}% of customers who visited never came back (one-and-done). ${c.reactivationEligible.count} are reactivation-eligible — $${winbackUsd.toLocaleString()} of lifetime value to win back.`,
                  metric: `${c.oneAndDone.pct}% one-and-done`,
                  cta: { label: "Run Win-Back", section: "reEngagement" },
                };
              }
            } catch (e) { void e; }
            return null;
          }
          case "revenue": {
            return null;
          }
          case "leads": {
            // Stale unactioned leads
            try {
              const { leads } = await import("../../../../drizzle/schema");
              const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
              const [stale] = await d
                .select({ count: sql<number>`count(*)` })
                .from(leads)
                .where(and(
                  eq(leads.status, "new"),
                  sql`${leads.createdAt} < ${oneDayAgo}`,
                ));
              const cnt = Number(stale?.count || 0);
              if (cnt > 0) {
                return {
                  variant: "warning" as const,
                  message: `Leads sitting unactioned for 24+ hours. Conversion drops 80% after the first day.`,
                  metric: `${cnt} stale lead${cnt === 1 ? "" : "s"}`,
                  cta: { label: "Open Leads", section: "leads" },
                };
              }
            } catch (e) { void e; }
            return null;
          }
          case "callTrackingView": {
            // Pending callbacks
            try {
              const { callbackRequests } = await import("../../../../drizzle/schema");
              const [pending] = await d
                .select({ count: sql<number>`count(*)` })
                .from(callbackRequests)
                .where(sql`${callbackRequests.status} IN ('new', 'pending')`);
              const cnt = Number(pending?.count || 0);
              if (cnt > 0) {
                return {
                  variant: "danger" as const,
                  message: `Customers waiting for a return call. Every hour drops conversion ~10%.`,
                  metric: `${cnt} callback${cnt === 1 ? "" : "s"} pending`,
                  cta: { label: "Call them", section: "callTrackingView" },
                };
              }
            } catch (e) { void e; }
            return null;
          }
          case "declinedEstimates": {
            // Walk-aways pending recovery
            try {
              const { algEstimates } = await import("../../../../drizzle/schema");
              const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
              const [wa] = await d
                .select({
                  count: sql<number>`count(*)`,
                  total: sql<number>`COALESCE(SUM(${algEstimates.estimatedAmount}), 0)`,
                })
                .from(algEstimates)
                .where(and(
                  isNull(algEstimates.matchedInvoiceId),
                  gte(algEstimates.estimateDate, sixtyDaysAgo),
                ));
              const cnt = Number(wa?.count || 0);
              const total = Math.round(Number(wa?.total || 0) / 100);
              if (cnt > 0) {
                // wave-181.72 (highest-leverage move) · the recovery cron
                // has been DRY-RUNNING for months because FEATURE_DECLINED_
                // RECOVERY env flag was never set. With wave-181.60 (at-
                // most-once) + wave-181.68 (durable rate-limit) + wave-181.69
                // (alert dedup), the cron is now production-safe. Single
                // env flag flip on Railway unleashes the entire pipeline.
                const featureOn = process.env.FEATURE_DECLINED_RECOVERY === "1";
                if (!featureOn && total >= 50_000) {
                  return {
                    variant: "danger" as const,
                    message: `$${total.toLocaleString()} in walked-away estimates sitting IDLE. SMS recovery cron is in DRY-RUN mode — set FEATURE_DECLINED_RECOVERY=1 on Railway to unleash auto-send (at-most-once protected · TCPA opt-out enforced · 20 sends/run cap). 30 seconds of operator time → live pipeline.`,
                    metric: `$${total.toLocaleString()} idle · ${cnt} estimates · 1 env flag`,
                    cta: { label: "See Status", section: "settings", settingsTab: "shopdriver" },
                  };
                }
                return {
                  variant: featureOn ? "primary" as const : "warning" as const,
                  message: featureOn
                    ? `Walked-away estimates from last 60 days · recovery cron actively processing.`
                    : `Walked-away estimates from last 60 days. SMS recovery cron targets these — set FEATURE_DECLINED_RECOVERY=1 to activate.`,
                  metric: `$${total.toLocaleString()} ${featureOn ? "in flight" : "recoverable"}`,
                  cta: { label: "See Status", section: "settings", settingsTab: "shopdriver" },
                };
              }
            } catch (e) { void e; }
            return null;
          }
          case "reEngagement": {
            // Negative reviews from last 7 days
            try {
              const { reviewReplies } = await import("../../../../drizzle/schema");
              const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
              const [neg] = await d
                .select({ count: sql<number>`count(*)` })
                .from(reviewReplies)
                .where(and(
                  sql`${reviewReplies.reviewRating} <= 2`,
                  gte(reviewReplies.reviewDate, sevenDaysAgo),
                  sql`(${reviewReplies.status} IS NULL OR ${reviewReplies.status} IN ('draft', 'pending'))`,
                ));
              const cnt = Number(neg?.count || 0);
              if (cnt > 0) {
                return {
                  variant: "danger" as const,
                  message: `Negative reviews waiting for response. Public reply within 24h preserves trust score.`,
                  metric: `${cnt} review${cnt === 1 ? "" : "s"}`,
                  cta: { label: "Open Re-engagement", section: "reEngagement" },
                };
              }
            } catch (e) { void e; }
            return null;
          }
          case "settings": {
            // wave-181.80 (week-audit revenue-flag sweep) · consolidated
            // check across all 3 revenue-cron gates that have been silently
            // OFF in prod:
            //   1. FEATURE_DECLINED_RECOVERY env flag · declined-recovery cron
            //   2. retention_7day DB flag · D7 post-visit check-in (wave-181.47)
            //   3. retention_14day DB flag · D14 reactivation (wave-181.47)
            // cron_log audit showed 112+ runs in 7 days producing 0 records
            // for each. Production-safe to flip thanks to the wave-181.59
            // at-most-once claim + wave-181.60 TCPA opt-out + wave-181.68
            // durable rate-limit + wave-181.64 sending-hours guard.
            const featureRecovery = process.env.FEATURE_DECLINED_RECOVERY === "1";

            // Read DB flag state · read-only, fail-soft (return null if the
            // table query errors so the dashboard never breaks on a flag bug).
            let retention7dOn = true;
            let retention14dOn = true;
            try {
              const { featureFlags } = await import("../../../../drizzle/schema");
              const flags = await d
                .select({ key: featureFlags.key, value: featureFlags.value })
                .from(featureFlags)
                .where(inArray(featureFlags.key, ["retention_7day", "retention_14day"]));
              for (const f of flags) {
                if (f.key === "retention_7day") retention7dOn = Number(f.value) === 1;
                if (f.key === "retention_14day") retention14dOn = Number(f.value) === 1;
              }
            } catch { /* fail-soft · assume on so we don't false-alarm */ }

            const blockers: string[] = [];
            if (!featureRecovery) blockers.push("FEATURE_DECLINED_RECOVERY (Railway env)");
            if (!retention7dOn) blockers.push("retention_7day (DB flag)");
            if (!retention14dOn) blockers.push("retention_14day (DB flag)");

            if (blockers.length > 0) {
              return {
                variant: blockers.length >= 2 ? "danger" as const : "warning" as const,
                message: `${blockers.length} revenue-cron gate${blockers.length === 1 ? "" : "s"} OFF · pipelines running but producing 0 sends. Blockers: ${blockers.join(" · ")}. All gates are production-safe to flip (at-most-once + TCPA + rate-limit guards verified wave-181.58 → wave-181.79).`,
                metric: `${blockers.length} of 3 gates OFF`,
                cta: { label: "Operator runbook", section: "settings", settingsTab: "flags" },
              };
            }
            return null;
          }
          default:
            return null;
        }
      } catch (err) {
        return null;
      }
    }),



};
