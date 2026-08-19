/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure, publicProcedure, router } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { callEvents } from "../../../drizzle/schema";

import { db } from "../../lib/db-helper";
import { BoundedTtlMap } from "../../lib/boundedTtlMap";

import { createLogger } from "../../lib/logger";

const log = createLogger("routers:admin");

// ─── CALL TRACKING ─────────────────────────────────────

// wave-141b — IP rate limit on logCall (15 events/min/IP). The procedure
// is publicProcedure because legit phone-click tracking fires from the
// public site, so the limit keeps an open endpoint from being used to
// flood call_events with junk rows.
//
// 2026-08-19: the SMS side-effect this limit was originally written to
// contain (scheduleCallReviewRequest) is gone. It could never reach a
// customer — the client sends the SHOP's own hardcoded number as
// `phoneNumber` (a tel: click never exposes the visitor's number), so the
// only request it could ever schedule was the shop texting itself. Worse,
// the field was caller-controlled on a public procedure, so an actor could
// POST any number and trigger a review-request SMS to it. Deleted rather
// than repaired: there is no argument value that makes it correct.
const logCallIpLimit = new BoundedTtlMap<number>({ ttlMs: 60_000, maxEntries: 10_000 });
const LOG_CALL_MAX_PER_MIN = 15;

export const callTrackingRouter = router({
  /** Log a phone click event from the frontend */
  logCall: publicProcedure
    // NULLISH fields — frontend sends `null` when UTM is absent.
    // Previous `.optional()` only allowed missing keys, not `null` values,
    // which made the whole payload fail validation and meant we had
    // ZERO rows in call_events despite active phone-click instrumentation.
    .input(z.object({
      phoneNumber: z.string().max(20),
      sourcePage: z.string().max(500).nullish(),
      clickElement: z.string().max(200).nullish(),
      utmSource: z.string().max(100).nullish(),
      utmMedium: z.string().max(100).nullish(),
      utmCampaign: z.string().max(255).nullish(),
      landingPage: z.string().max(500).nullish(),
      referrer: z.string().max(500).nullish(),
      userAgent: z.string().max(500).nullish(),
      // journey-join migration 0068 — localStorage visitor id + the Meta
      // pixel event_id the client's Contact event fired with.
      sessionId: z.string().max(64).nullish(),
      eventId: z.string().max(64).nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      // wave-141b — per-IP rate limit on this public endpoint.
      const ip = ctx.req?.ip || ctx.req?.socket?.remoteAddress || "unknown";
      const count = (logCallIpLimit.get(ip) ?? 0) + 1;
      logCallIpLimit.set(ip, count);
      if (count > LOG_CALL_MAX_PER_MIN) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many call-tracking events from this client" });
      }

      const d = await db();
      if (!d) return { success: false };
      try {
        await d.insert(callEvents).values({
          phoneNumber: input.phoneNumber,
          sourcePage: input.sourcePage || null,
          clickElement: input.clickElement || null,
          utmSource: input.utmSource || null,
          utmMedium: input.utmMedium || null,
          utmCampaign: input.utmCampaign || null,
          landingPage: input.landingPage || null,
          referrer: input.referrer || null,
          userAgent: input.userAgent || null,
          sessionId: input.sessionId || null,
          eventId: input.eventId || null,
        });

        return { success: true };
      } catch (err) {
        log.error("[CallTracking] Error logging call:", err);
        return { success: false };
      }
    }),

  /** Get all call events (admin) */
  list: adminProcedure
    .input(z.object({ limit: z.number().default(100) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      return d.select().from(callEvents)
        .orderBy(desc(callEvents.createdAt))
        .limit(input?.limit ?? 100);
    }),
});
