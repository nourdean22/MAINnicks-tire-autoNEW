/**
 * AI-assistant referrals: staff log at the counter + a 30-day summary.
 *
 * 2026-10-21: customers now arrive because ChatGPT or Meta AI named the shop,
 * and nothing recorded how a customer heard about us. No schema change: a log
 * is one customer_events row named admin_ai_referral (the public
 * customerEvents.log refuses admin_* names, so only this admin path writes it).
 * The summary adds web rows from bookings, leads and call_events whose
 * utmSource or referrer names an assistant (shared/aiReferral.ts).
 */
import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { adminProcedure, router } from "../../_core/trpc";
import { db } from "../../lib/db-helper";
import { createLogger } from "../../lib/logger";
import { sqlUtcDateTime } from "../../services/autonomyControl";
import { AI_ASSISTANT_IDS, aiAssistantFromAttribution, type AiAssistantId } from "../../../shared/aiReferral";
import { bookings, callEvents, customerEvents, leads } from "../../../drizzle/schema";

const log = createLogger("routers:aiReferrals");

const EVENT_NAME = "admin_ai_referral";
const WINDOW_DAYS = 30;
// shortcut: each table read is capped at 5000 rows (customer_events, bookings, leads,
// call_events separately), so a window busier than that undercounts; move the grouping
// into SQL if any one table ever nears 5000 rows in 30 days.
const READ_LIMIT = 5000;

type Counts = Partial<Record<AiAssistantId, number>>;
const bump = (c: Counts, id: AiAssistantId) => { c[id] = (c[id] ?? 0) + 1; };
const KNOWN_IDS = new Set<string>(AI_ASSISTANT_IDS);

function assistantOf(eventData: unknown): AiAssistantId {
  let data = eventData;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = null; }
  }
  const id = (data as { assistant?: unknown } | null)?.assistant;
  return typeof id === "string" && KNOWN_IDS.has(id) ? (id as AiAssistantId) : "other";
}

export const aiReferralsRouter = router({
  log: adminProcedure
    .input(z.object({
      assistant: z.enum(AI_ASSISTANT_IDS),
      topic: z.enum(["tires", "repair", "other"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable; the referral was not saved." });
      try {
        await d.insert(customerEvents).values({
          eventName: EVENT_NAME,
          eventData: { assistant: input.assistant, topic: input.topic ?? null },
          sourcePage: "/admin",
        });
      } catch (err) {
        log.error("[aiReferrals] log insert failed:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The referral was not saved. Try again.", cause: err });
      }
      return { ok: true as const };
    }),

  summary: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { windowDays: WINDOW_DAYS, logged: null, web: null };
    const since = sqlUtcDateTime(new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000));

    let logged: { total: number; byAssistant: Counts } | null = null;
    try {
      const rows: Array<{ eventData: unknown }> = await d
        .select({ eventData: customerEvents.eventData })
        .from(customerEvents)
        .where(and(eq(customerEvents.eventName, EVENT_NAME), sql`${customerEvents.createdAt} >= ${since}`))
        .limit(READ_LIMIT);
      const byAssistant: Counts = {};
      for (const r of rows) bump(byAssistant, assistantOf(r.eventData));
      logged = { total: rows.length, byAssistant };
    } catch (err) {
      log.error("[aiReferrals] logged read failed:", err);
    }

    let web: { total: number; byAssistant: Counts; bySurface: { bookings: number; leads: number; calls: number } } | null = null;
    try {
      const surfaces = { bookings, leads, calls: callEvents } as const;
      const byAssistant: Counts = {};
      const bySurface = { bookings: 0, leads: 0, calls: 0 };
      for (const [surface, t] of Object.entries(surfaces) as Array<[keyof typeof bySurface, typeof bookings | typeof leads | typeof callEvents]>) {
        const rows: Array<{ utmSource: string | null; referrer: string | null }> = await d
          .select({ utmSource: t.utmSource, referrer: t.referrer })
          .from(t)
          .where(and(sql`${t.createdAt} >= ${since}`, or(isNotNull(t.utmSource), isNotNull(t.referrer))))
          .limit(READ_LIMIT);
        for (const r of rows) {
          const id = aiAssistantFromAttribution(r);
          if (!id) continue;
          bump(byAssistant, id);
          bySurface[surface] += 1;
        }
      }
      web = { total: bySurface.bookings + bySurface.leads + bySurface.calls, byAssistant, bySurface };
    } catch (err) {
      log.error("[aiReferrals] web read failed:", err);
    }

    return { windowDays: WINDOW_DAYS, logged, web };
  }),
});
