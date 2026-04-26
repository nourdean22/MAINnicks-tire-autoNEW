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
import { sql, gte, and, desc, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { createLogger } from "../lib/logger";

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

        // Count distinct session_ids in the last 5 min from page-view events.
        // Falls back gracefully if the analytics_events table doesn't exist
        // or is empty.
        const [rows] = await d.execute(sql`
          SELECT COUNT(DISTINCT session_id) AS cnt
          FROM analytics_events
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
            AND event_type = 'page_view'
        `).catch(() => [[]] as any);
        const count = Number((rows as any)?.[0]?.cnt) || 0;
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
          const [activity] = await d.execute(sql`
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
          `).catch(() => [[]] as any);

          const items = ((activity as any[]) || []).map((row: any) => ({
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
        const [woRows] = await d.execute(sql`
          SELECT COUNT(*) as cnt FROM work_orders
          WHERE status IN ('in_progress', 'waiting_parts', 'quality_check')
            AND COALESCE(updated_at, created_at) >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        `).catch(() => [[]] as any);
        const activeWOs = Number((woRows as any)?.[0]?.cnt) || 0;

        // Today's bookings
        const [bkRows] = await d.execute(sql`
          SELECT COUNT(*) as cnt FROM bookings
          WHERE createdAt >= CURDATE() AND status IN ('new', 'confirmed')
        `).catch(() => [[]] as any);
        const todayBookings = Number((bkRows as any)?.[0]?.cnt) || 0;

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
});
