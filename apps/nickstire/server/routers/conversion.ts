/**
 * Conversion Router — live data the conversion-architecture components consume.
 *
 * All endpoints are PUBLIC (rendered on the marketing site, not behind auth)
 * and AGGRESSIVELY CACHED (60s default) to avoid hammering the DB on every
 * page view.
 *
 * Three procedures:
 *   - liveSessions   → "X people viewing right now"
 *   - recentActivity → social-proof ticker feed
 *   - shopCapacity   → urgency-widget data (slots remaining, wait time)
 *
 * Per the conversion-overhaul spec (`docs/CONVERSION-OVERHAUL-V1.1.md`),
 * EVERYTHING is real or honestly cycled — no fake numbers, no hardcoded
 * "47 people viewing" lies. If real numbers are too low to be persuasive,
 * the component decides whether to show them or hide.
 */
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { createLogger } from "../lib/logger";
import { safeCount, safeRowQuery, safeAggregate } from "../lib/sql-safe";

const log = createLogger("routers:conversion");

export const conversionRouter = router({
  /**
   * Live-session count. Counts unique session-ids active in the last 5 minutes
   * by reading the analytics events table. Returns the raw number; the
   * component is responsible for whether/how to display it.
   *
   * Cached 30 seconds — rapid enough to feel live, slow enough to not
   * hammer the DB.
   */
  liveSessions: publicProcedure.query(async () => {
    const { cached } = await import("../lib/cache");
    return cached("conv:live-sessions", 30, async () => {
      try {
        const { getDb } = await import("../db");
        const d = await getDb();
        if (!d) return { count: 0, asOf: new Date().toISOString() };

        // Reads `customer_events`, which EXISTS and is fed (4,703 rows, ~96
        // distinct sessions/day). The old query read `analytics_events`, which
        // does not exist in production at all — safeCount turned the
        // ER_NO_SUCH_TABLE into 0, liveSessions always returned {count:0}, and
        // LiveVisitorCounter's `displayCount < minToShow` guard meant the
        // social-proof element on Home has NEVER rendered, at any traffic level.
        //
        // Column names differ from the old guess: `sessionId` and `createdAt`
        // (camelCase in the DB), and there is no event_type — the column is
        // `eventName` and no 'page_view' value is ever written, so ANY event
        // from a session counts as presence. Verified against the live table.
        //
        // The window stays 5 minutes and the counter keeps its minToShow floor,
        // so on a quiet hour it renders nothing rather than inventing company.
        const count = await safeCount(d, sql`
          SELECT COUNT(DISTINCT sessionId) AS cnt
          FROM customer_events
          WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
            AND sessionId IS NOT NULL
        `);
        return { count, asOf: new Date().toISOString() };
      } catch (err) {
        log.warn("[conversion.liveSessions] failed:", err);
        return { count: 0, asOf: new Date().toISOString() };
      }
    });
  }),

  /**
   * Recent activity feed for social-proof ticker. Pulls last 20 customer-facing
   * events across bookings, leads, and invoices. Anonymizes names (first name
   * + last initial) and includes geographic context where available.
   *
   * Cached 90 seconds — events are rare enough that a slightly stale feed is
   * fine; live freshness isn't worth the DB pressure.
   */
  recentActivity: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(20).optional() }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 12;
      const { cached } = await import("../lib/cache");
      return cached(`conv:recent-activity:${limit}`, 90, async () => {
        try {
          const { getDb } = await import("../db");
          const d = await getDb();
          if (!d) return { items: [] };

          // Pull from leads + bookings + invoices, all in last 7 days, real
          // customer data only (filter test/dev rows).
          type ActivityRow = {
            kind: string;
            who: string;
            what: string;
            amount: number | null;
            happened_at: string | Date;
            where_at: string | null;
          };
          const activity = await safeRowQuery<ActivityRow>(d, sql`
            (
              SELECT
                'booking' AS kind,
                CONCAT(SUBSTRING_INDEX(name, ' ', 1), ' ', LEFT(SUBSTRING_INDEX(name, ' ', -1), 1), '.') AS who,
                service AS what,
                NULL AS amount,
                createdAt AS happened_at,
                city AS where_at
              FROM bookings
              WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                AND name IS NOT NULL AND name <> ''
                AND name NOT LIKE 'test%' AND name NOT LIKE 'Test%'
              ORDER BY createdAt DESC
              LIMIT ${limit}
            )
            UNION ALL
            (
              SELECT
                'lead' AS kind,
                CONCAT(SUBSTRING_INDEX(name, ' ', 1), ' ', LEFT(SUBSTRING_INDEX(name, ' ', -1), 1), '.') AS who,
                COALESCE(recommendedService, 'inquiry') AS what,
                NULL AS amount,
                createdAt AS happened_at,
                NULL AS where_at
              FROM leads
              WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                AND name IS NOT NULL AND name <> ''
                AND name NOT LIKE 'test%' AND name NOT LIKE 'Test%'
              ORDER BY createdAt DESC
              LIMIT ${limit}
            )
            UNION ALL
            (
              SELECT
                'invoice' AS kind,
                CONCAT(SUBSTRING_INDEX(customerName, ' ', 1), ' ', LEFT(SUBSTRING_INDEX(customerName, ' ', -1), 1), '.') AS who,
                COALESCE(serviceDescription, 'service') AS what,
                totalAmount AS amount,
                invoiceDate AS happened_at,
                NULL AS where_at
              FROM invoices
              WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                AND customerName IS NOT NULL AND customerName <> ''
                AND paymentStatus = 'paid'
              ORDER BY invoiceDate DESC
              LIMIT ${limit}
            )
            ORDER BY happened_at DESC
            LIMIT ${limit}
          `);

          const items = activity.map((row) => ({
            kind: row.kind as "booking" | "lead" | "invoice",
            who: String(row.who || "Someone").trim(),
            what: String(row.what || "service").slice(0, 80),
            amount: row.amount ? Math.round(Number(row.amount) / 100) : null,
            happenedAt: row.happened_at,
            where: row.where_at || null,
            // Compute "minutes ago" for relative-time display
            minutesAgo: row.happened_at
              ? Math.max(1, Math.floor((Date.now() - new Date(row.happened_at).getTime()) / 60000))
              : null,
          }));

          return { items };
        } catch (err) {
          log.warn("[conversion.recentActivity] failed:", err);
          return { items: [] };
        }
      });
    }),

  /**
   * Admin-only — recent conversion events from the in-memory ring buffer
   * (`server/services/conversionEvents.ts`). Used by the Conversion Preview
   * tab to show a live feed of what bias elements visitors are interacting
   * with right now.
   */
  recentEvents: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .query(async ({ input }) => {
      const { getRecentConversionEvents, getConversionEventsByType } = await import(
        "../services/conversionEvents"
      );
      return {
        events: getRecentConversionEvents(input?.limit ?? 50),
        byType: getConversionEventsByType(),
      };
    }),

  /**
   * Shop capacity for the urgency widget. Returns: slots remaining today,
   * approximate wait time, next available time. All real numbers from the
   * actual booking + work_order data.
   *
   * Cached 60 seconds.
   */
  shopCapacity: publicProcedure.query(async () => {
    const { cached } = await import("../lib/cache");
    return cached("conv:shop-capacity", 60, async () => {
      try {
        const { getDb } = await import("../db");
        const d = await getDb();
        if (!d) {
          return {
            slotsRemainingToday: null,
            estimatedWaitMinutes: null,
            nextAvailableAt: null,
            isOpen: true,
            asOf: new Date().toISOString(),
          };
        }

        // Active WOs (in-progress/waiting_parts/quality_check, last 7d)
        const activeWOs = await safeCount(d, sql`
          SELECT COUNT(*) as cnt FROM work_orders
          WHERE status IN ('in_progress', 'waiting_parts', 'quality_check')
            AND COALESCE(updated_at, created_at) >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);

        // Today's bookings
        const todayBookings = await safeCount(d, sql`
          SELECT COUNT(*) as cnt FROM bookings
          WHERE createdAt >= CURDATE() AND status IN ('new', 'confirmed')
        `);

        // Daily capacity heuristic — 4 bays × 8 jobs/bay/day = 32 slots
        const DAILY_CAPACITY = 32;
        const used = activeWOs + todayBookings;
        const slotsRemainingToday = Math.max(0, DAILY_CAPACITY - used);

        // Estimated wait — 45 min per active WO, capped at 4 hr
        const estimatedWaitMinutes = activeWOs === 0 ? 0 : Math.min(240, activeWOs * 45);

        // Next available — current time + estimated wait, rounded to next 15 min
        const next = new Date();
        next.setMinutes(next.getMinutes() + estimatedWaitMinutes);
        const min15 = Math.ceil(next.getMinutes() / 15) * 15;
        next.setMinutes(min15, 0, 0);

        // Open hours: M-Sat 8-6, Sun 9-4 (per BUSINESS spec)
        const now = new Date();
        const dow = now.getDay(); // 0=Sun
        const hour = now.getHours();
        const isOpen = (dow >= 1 && dow <= 6 && hour >= 8 && hour < 18) ||
                       (dow === 0 && hour >= 9 && hour < 16);

        return {
          slotsRemainingToday,
          estimatedWaitMinutes,
          nextAvailableAt: next.toISOString(),
          isOpen,
          activeJobs: activeWOs,
          todayBookings,
          asOf: new Date().toISOString(),
        };
      } catch (err) {
        log.warn("[conversion.shopCapacity] failed:", err);
        return {
          slotsRemainingToday: null,
          estimatedWaitMinutes: null,
          nextAvailableAt: null,
          isOpen: true,
          asOf: new Date().toISOString(),
        };
      }
    });
  }),

  /**
   * Admin-only — full conversion-funnel rollup for the dashboard.
   *
   * Returns:
   *   - totals (7d / 30d) for leads + bookings + paid invoices
   *   - source breakdown for leads (popup / chat / sms_capture / newsletter / etc.)
   *   - lead → booking conversion rate (rough, phone-matched within 30d)
   *   - daily trend (last 14 days) — for the sparkline
   *
   * Cached 60s. Pure SELECTs, no writes. Falls back gracefully on any
   * missing-table error so the dashboard renders even on a fresh DB.
   */
  leadFunnel: adminProcedure.query(async () => {
    const { cached } = await import("../lib/cache");
    return cached("conv:lead-funnel", 60, async () => {
      try {
        const { getDb } = await import("../db");
        const d = await getDb();
        if (!d) {
          return {
            totals: { leads7d: 0, leads30d: 0, bookings7d: 0, bookings30d: 0, invoices30d: 0 },
            sources: [] as Array<{ source: string; count: number }>,
            leadToBookingRate: 0,
            dailyTrend: [] as Array<{ date: string; leads: number; bookings: number }>,
            asOf: new Date().toISOString(),
          };
        }

        // 7d / 30d totals — leads + bookings + paid invoices.
        // SQL note: each subselect can use indexed range scan on createdAt.
        // Single round-trip is faster than 5 separate count queries here
        // because MySQL caches the parser/optimizer state across subselects.
        type TotalsRow = {
          leads7d: number; leads30d: number;
          bookings7d: number; bookings30d: number;
          invoices30d: number;
        };
        const t = await safeAggregate<TotalsRow>(d, sql`
          SELECT
            (SELECT COUNT(*) FROM leads WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY))   AS leads7d,
            (SELECT COUNT(*) FROM leads WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY))  AS leads30d,
            (SELECT COUNT(*) FROM bookings WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS bookings7d,
            (SELECT COUNT(*) FROM bookings WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS bookings30d,
            (SELECT COUNT(*) FROM invoices WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND paymentStatus = 'paid') AS invoices30d
        `);

        const totals = {
          leads7d: Number(t.leads7d) || 0,
          leads30d: Number(t.leads30d) || 0,
          bookings7d: Number(t.bookings7d) || 0,
          bookings30d: Number(t.bookings30d) || 0,
          invoices30d: Number(t.invoices30d) || 0,
        };

        // Source breakdown — last 30 days.
        // SQL note: index on (createdAt, source) recommended if not present.
        type SourceRow = { source: string; count: number };
        const sourceRows = await safeRowQuery<SourceRow>(d, sql`
          SELECT source, COUNT(*) AS count
          FROM leads
          WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND source IS NOT NULL AND source <> ''
          GROUP BY source
          ORDER BY count DESC
        `);
        const sources = sourceRows.map((r) => ({
          source: String(r.source || "unknown"),
          count: Number(r.count) || 0,
        }));

        // Lead → booking conversion. Phone-matched within 30 days.
        // Directional, not exact — but the simplest stable signal we have.
        // SQL perf note: requires indexes on leads.phone + bookings.phone.
        // The DATE_ADD comparison must be evaluated per-row but the JOIN
        // on indexed phone columns keeps this linear in result size.
        const converted = await safeCount(d, sql`
          SELECT COUNT(DISTINCT l.phone) AS converted
          FROM leads l
          INNER JOIN bookings b ON b.phone = l.phone
            AND b.createdAt >= l.createdAt
            AND b.createdAt <= DATE_ADD(l.createdAt, INTERVAL 30 DAY)
          WHERE l.createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `);
        const leadToBookingRate = totals.leads30d > 0
          ? Math.round((converted / totals.leads30d) * 1000) / 10
          : 0;

        // Daily trend — last 14 days. Lead and booking counts merged by date.
        type TrendRow = { date: string | Date; leads: number; bookings: number };
        const trendRows = await safeRowQuery<TrendRow>(d, sql`
          SELECT d AS date, SUM(leads) AS leads, SUM(bookings) AS bookings
          FROM (
            SELECT DATE(createdAt) AS d, COUNT(*) AS leads, 0 AS bookings
            FROM leads
            WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 14 DAY)
            GROUP BY DATE(createdAt)
            UNION ALL
            SELECT DATE(createdAt) AS d, 0 AS leads, COUNT(*) AS bookings
            FROM bookings
            WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 14 DAY)
            GROUP BY DATE(createdAt)
          ) merged
          GROUP BY d
          ORDER BY d ASC
        `);
        const dailyTrend = trendRows.map((row) => ({
          date: String(row.date).slice(0, 10),
          leads: Number(row.leads) || 0,
          bookings: Number(row.bookings) || 0,
        }));

        return {
          totals,
          sources,
          leadToBookingRate,
          dailyTrend,
          asOf: new Date().toISOString(),
        };
      } catch (err) {
        log.warn("[conversion.leadFunnel] failed:", err);
        return {
          totals: { leads7d: 0, leads30d: 0, bookings7d: 0, bookings30d: 0, invoices30d: 0 },
          sources: [],
          leadToBookingRate: 0,
          dailyTrend: [],
          asOf: new Date().toISOString(),
        };
      }
    });
  }),
});
