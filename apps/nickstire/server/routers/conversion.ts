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
import { router, publicProcedure } from "../_core/trpc";
import { sql } from "drizzle-orm";
import { excludeNonHumanTraffic } from "../lib/trafficClass";

import { createLogger } from "../lib/logger";
import { safeCount } from "../lib/sql-safe";
import { BUSINESS } from "@shared/business";

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
            AND ${excludeNonHumanTraffic()}
        `);
        return { count, asOf: new Date().toISOString() };
      } catch (err) {
        log.warn("[conversion.liveSessions] failed:", err);
        return { count: 0, asOf: new Date().toISOString() };
      }
    });
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
          // Fail closed: an unreadable DB must not assert the shop is open —
          // isOpen:true here let an outage manufacture urgency.
          return {
            slotsRemainingToday: null,
            estimatedWaitMinutes: null,
            isOpen: null,
            asOf: new Date().toISOString(),
          };
        }

        // Active WOs (in-progress/waiting_parts/quality_check, last 7d)
        const activeWOs = await safeCount(d, sql`
          SELECT COUNT(*) as cnt FROM work_orders
          WHERE status IN ('in_progress', 'waiting_parts', 'quality_check')
            AND COALESCE(updated_at, created_at) >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);

        // Today's bookings, since Eastern midnight. CURDATE() started "today"
        // at 8 PM ET the evening before (UTC midnight). A duration from the
        // DB's own NOW() avoids any driver-shifted timestamp.
        const { minutesSinceShopMidnight } = await import("../lib/timezoneAssert");
        const todayBookings = await safeCount(d, sql`
          SELECT COUNT(*) as cnt FROM bookings
          WHERE createdAt >= NOW() - INTERVAL ${minutesSinceShopMidnight(new Date())} MINUTE AND status IN ('new', 'confirmed')
        `);

        // Daily capacity heuristic — 4 bays × 8 jobs/bay/day = 32 slots
        const DAILY_CAPACITY = 32;
        const used = activeWOs + todayBookings;
        const slotsRemainingToday = Math.max(0, DAILY_CAPACITY - used);

        // Estimated wait — 45 min per active WO, capped at 4 hr. This is a
        // planning heuristic, not a measurement; the client must label it
        // as an estimate. (The fabricated "next available" timestamp is
        // gone: FCFS has no bookable slot, and nothing consumed it.)
        const estimatedWaitMinutes = activeWOs === 0 ? 0 : Math.min(240, activeWOs * 45);

        // Open hours: M-Sat 8-6, Sun 9-4 — evaluated in shop-local time.
        // Railway runs UTC, so process-local getHours() flipped isOpen
        // false from ~1-2PM ET onward (and true overnight). Same ET
        // pattern as services/shopStatus.ts.
        const now = new Date();
        const hour = parseInt(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }), 10);
        const dow = new Date(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone })).getDay(); // 0=Sun
        const isOpen = (dow >= 1 && dow <= 6 && hour >= 8 && hour < 18) ||
                       (dow === 0 && hour >= 9 && hour < 16);

        return {
          slotsRemainingToday,
          estimatedWaitMinutes,
          isOpen,
          activeJobs: activeWOs,
          todayBookings,
          asOf: new Date().toISOString(),
        };
      } catch (err) {
        log.warn("[conversion.shopCapacity] failed:", err);
        // Fail closed — see the !d branch above.
        return {
          slotsRemainingToday: null,
          estimatedWaitMinutes: null,
          isOpen: null,
          asOf: new Date().toISOString(),
        };
      }
    });
  }),
});
