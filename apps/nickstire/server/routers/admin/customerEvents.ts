/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure, publicProcedure, router } from "../../_core/trpc";
import { z } from "zod";
import { desc } from "drizzle-orm";

import { db } from "../../lib/db-helper";

import { createLogger } from "../../lib/logger";

const log = createLogger("routers:admin");

// ─── CUSTOMER EVENTS — generic visual/interaction event log ─────────
/**
 * Generic event sink for the customer-facing site (PhotoRibbon photo
 * views, sticky-CTA Hold-A-Bay clicks, scroll-depth milestones, etc.).
 * Pairs with callTracking — that one is phone-only; this is everything
 * else. Public log, admin summary.
 */
export const customerEventsRouter = router({
  /** Log a customer-facing event from the frontend */
  log: publicProcedure
    .input(z.object({
      eventName: z.string().min(1).max(64),
      eventData: z.record(z.string(), z.unknown()).optional(),
      sourcePage: z.string().max(500).nullish(),
      utmSource: z.string().max(100).nullish(),
      utmMedium: z.string().max(100).nullish(),
      utmCampaign: z.string().max(255).nullish(),
      referrer: z.string().max(500).nullish(),
      userAgent: z.string().max(500).nullish(),
      sessionId: z.string().max(64).nullish(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false };
      try {
        const { customerEvents } = await import("../../../drizzle/schema");
        await d.insert(customerEvents).values({
          eventName: input.eventName,
          eventData: (input.eventData ?? null) as unknown as object,
          sourcePage: input.sourcePage || null,
          utmSource: input.utmSource || null,
          utmMedium: input.utmMedium || null,
          utmCampaign: input.utmCampaign || null,
          referrer: input.referrer || null,
          userAgent: input.userAgent || null,
          sessionId: input.sessionId || null,
        });
        return { success: true };
      } catch (err) {
        log.error("[CustomerEvents] Error logging event:", err);
        return { success: false };
      }
    }),

  /** Per-event totals + last-N-day series for the admin dashboard.
   *  Keep response small — full timeline lives in `recent` if needed. */
  summary: adminProcedure
    .input(z.object({
      days: z.number().min(1).max(180).default(30),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return { totals: [], recent: [], days: 30 };
      const { customerEvents } = await import("../../../drizzle/schema");
      const days = input?.days ?? 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const { sql, gte } = await import("drizzle-orm");

      // Per-event totals over the window
      const totalsRows = await d
        .select({
          eventName: customerEvents.eventName,
          count: sql<number>`COUNT(*)`,
        })
        .from(customerEvents)
        .where(gte(customerEvents.createdAt, since))
        .groupBy(customerEvents.eventName)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(20);

      // Most-recent 50 events for the dashboard "live tail"
      const recent = await d
        .select()
        .from(customerEvents)
        .orderBy(desc(customerEvents.createdAt))
        .limit(50);

      return {
        totals: totalsRows.map((r: typeof totalsRows[number]) => ({
          eventName: r.eventName,
          count: Number(r.count),
        })),
        recent,
        days,
      };
    }),

  /** Top photos in PhotoRibbon by view count — supports the admin
   *  "which photos are working?" question for content tuning. */
  topRibbonPhotos: adminProcedure
    .input(z.object({
      days: z.number().min(1).max(180).default(30),
      limit: z.number().min(1).max(50).default(20),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      const { customerEvents } = await import("../../../drizzle/schema");
      const days = input?.days ?? 30;
      const limit = input?.limit ?? 20;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const { sql, and, eq, gte } = await import("drizzle-orm");

      // Pull JSON.src from eventData. MySQL's JSON_EXTRACT works here
      // because we typed the column as `json`. Drizzle's runtime helper
      // is overkill — raw sql is fine and indexable on (eventName,
      // createdAt) which is the access pattern.
      const rows = await d
        .select({
          src: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${customerEvents.eventData}, '$.src'))`,
          count: sql<number>`COUNT(*)`,
        })
        .from(customerEvents)
        .where(and(
          eq(customerEvents.eventName, "ribbon_photo_view"),
          gte(customerEvents.createdAt, since),
        ))
        .groupBy(sql`JSON_UNQUOTE(JSON_EXTRACT(${customerEvents.eventData}, '$.src'))`)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(limit);

      return rows.map((r: typeof rows[number]) => ({
        src: r.src,
        count: Number(r.count),
      }));
    }),
});
