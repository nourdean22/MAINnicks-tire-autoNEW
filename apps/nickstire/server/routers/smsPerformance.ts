/**
 * wave-181.51 · SMS Performance — reply + conversion attribution read-out.
 *
 * Reads sms_messages.{replyCount, firstReplyAt, optOutAt, convertedCount,
 * attributedBookingId, attributedAt, variantKey} written by the
 * smsInstrumentation helpers + eventBus subscriber.
 *
 * Two queries:
 *   summary30d   — per-tier rollup of last 30 days of outbound sends.
 *                  Powers the dashboard table (Tier · Sent · Reply rate
 *                  · Conversion rate).
 *   recentSends  — last 50 outbound sends with per-row attribution state.
 *                  Powers the drill-in modal.
 *
 * Tier label: derived from variantKey. variantKey is "retention_d7" or
 * "retention_d7_v1" (A/B test bucket) or "declined_d7" / "cross_sell".
 * Pre-181.51 NULL rows aggregate into "untagged". The label strips
 * any "_v1"/"_v2" suffix so A/B buckets roll up under their parent tier
 * in summary view; the per-row drill-in shows the raw variantKey so
 * the operator can spot a running A/B test.
 */
import { adminProcedure, router } from "../_core/trpc";
import { and, desc, eq, gte, sql, isNull } from "drizzle-orm";
import { z } from "zod";
import { smsMessages, smsConversations } from "../../drizzle/schema";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";

const log = createLogger("routers:smsPerformance");

/** Reply window per outbound send — must match smsInstrumentation. */
const REPLY_WINDOW_DAYS = 7;
/** Conversion window per outbound send — must match smsInstrumentation. */
const CONVERSION_WINDOW_DAYS = 14;

/**
 * Strip the "_v1"/"_v2" A/B suffix to roll up a tier's variants under
 * the same parent label in summary view. "retention_d7_v2" → "retention_d7".
 * "cross_sell" → "cross_sell" (untouched). NULL → "untagged".
 */
function rollupKey(variantKey: string | null): string {
  if (!variantKey) return "untagged";
  return variantKey.replace(/_v\d+$/, "");
}

/**
 * Pretty label for the dashboard. Maps the rollup key to operator-
 * readable text. Unknown keys fall through to the raw key so a typo
 * in a cron doesn't render as nothing.
 */
function prettyTier(rollup: string): string {
  const map: Record<string, string> = {
    untagged: "Untagged (pre-181.51)",
    retention_d7: "Retention · D7",
    retention_d14: "Retention · D14",
    retention_d45: "Retention · D45",
    retention_d90: "Retention · D90",
    retention_d180: "Retention · D180",
    retention_d365: "Retention · D365",
    declined_d7: "Declined-recovery · D7",
    declined_d30: "Declined-recovery · D30",
    cross_sell: "Cross-sell",
  };
  return map[rollup] ?? rollup;
}

export const smsPerformanceRouter = router({
  /**
   * 30-day per-tier rollup. Counts sends, replies (any), conversions
   * (any), and opt-outs. Reply/conversion rates are computed on the
   * client — return raw counts so the UI can format consistently.
   */
  summary30d: adminProcedure.query(async () => {
    try {
      const d = await db();
      if (!d) {
        return {
          windowDays: 30,
          replyWindowDays: REPLY_WINDOW_DAYS,
          conversionWindowDays: CONVERSION_WINDOW_DAYS,
          tiers: [] as { key: string; tier: string; sent: number; replied: number; converted: number; optedOut: number }[],
        };
      }
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const rows = await d
        .select({
          variantKey: smsMessages.variantKey,
          sent: sql<number>`COUNT(*)`,
          replied: sql<number>`SUM(CASE WHEN ${smsMessages.replyCount} > 0 THEN 1 ELSE 0 END)`,
          converted: sql<number>`SUM(CASE WHEN ${smsMessages.convertedCount} > 0 THEN 1 ELSE 0 END)`,
          optedOut: sql<number>`SUM(CASE WHEN ${smsMessages.optOutAt} IS NOT NULL THEN 1 ELSE 0 END)`,
        })
        .from(smsMessages)
        .where(and(
          eq(smsMessages.direction, "outbound"),
          gte(smsMessages.createdAt, since),
        ))
        .groupBy(smsMessages.variantKey);

      // Roll up A/B variants under their parent tier. Group again in JS
      // because the SQL-level grouping splits "retention_d7_v1" from
      // "retention_d7_v2" and we want to show ONE row per tier in the
      // summary; the drill-in carries the raw variant for the operator.
      const rollup = new Map<string, { tier: string; sent: number; replied: number; converted: number; optedOut: number }>();
      for (const r of rows) {
        const key = rollupKey(r.variantKey);
        const cur = rollup.get(key) ?? { tier: prettyTier(key), sent: 0, replied: 0, converted: 0, optedOut: 0 };
        cur.sent += Number(r.sent);
        cur.replied += Number(r.replied);
        cur.converted += Number(r.converted);
        cur.optedOut += Number(r.optedOut);
        rollup.set(key, cur);
      }

      // Sort by sent desc so the highest-volume tiers lead.
      const out = [...rollup.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.sent - a.sent);

      return {
        windowDays: 30,
        replyWindowDays: REPLY_WINDOW_DAYS,
        conversionWindowDays: CONVERSION_WINDOW_DAYS,
        tiers: out,
      };
    } catch (err) {
      log.warn("summary30d failed", { error: err instanceof Error ? err.message : String(err) });
      // Fail-open: empty result rather than 500 the admin page.
      // This typically means the 0039 migration hasn't applied yet.
      return {
        windowDays: 30,
        replyWindowDays: REPLY_WINDOW_DAYS,
        conversionWindowDays: CONVERSION_WINDOW_DAYS,
        tiers: [] as { key: string; tier: string; sent: number; replied: number; converted: number; optedOut: number }[],
      };
    }
  }),

  /**
   * Last N outbound sends with per-row attribution. Powers the drill-in
   * table — operator can see exactly which send got a reply and which
   * landed a booking.
   */
  recentSends: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(200).default(50),
      tier: z.string().optional(),
    }).optional())
    .query(async ({ input }): Promise<Array<{
      id: number;
      createdAt: Date;
      body: string;
      variantKey: string | null;
      status: string;
      replyCount: number;
      firstReplyAt: Date | null;
      optOutAt: Date | null;
      convertedCount: number;
      attributedBookingId: number | null;
      attributedAt: Date | null;
      phoneSuffix: string;
      tier: string;
    }>> => {
      try {
        const d = await db();
        if (!d) return [];
        const limit = input?.limit ?? 50;

        type Row = {
          id: number;
          createdAt: Date;
          body: string;
          phone: string;
          variantKey: string | null;
          status: string;
          replyCount: number;
          firstReplyAt: Date | null;
          optOutAt: Date | null;
          convertedCount: number;
          attributedBookingId: number | null;
          attributedAt: Date | null;
        };

        const rows: Row[] = await d
          .select({
            id: smsMessages.id,
            createdAt: smsMessages.createdAt,
            body: smsMessages.body,
            phone: smsConversations.phone,
            variantKey: smsMessages.variantKey,
            status: smsMessages.status,
            replyCount: smsMessages.replyCount,
            firstReplyAt: smsMessages.firstReplyAt,
            optOutAt: smsMessages.optOutAt,
            convertedCount: smsMessages.convertedCount,
            attributedBookingId: smsMessages.attributedBookingId,
            attributedAt: smsMessages.attributedAt,
          })
          .from(smsMessages)
          .innerJoin(smsConversations, eq(smsMessages.conversationId, smsConversations.id))
          .where(and(
            eq(smsMessages.direction, "outbound"),
            // wave-181.59 · "untagged" tier filter returned 0 rows because
            // NULL never matches a LIKE expression in SQL. Branch the
            // predicate: "untagged" → IS NULL, any other tier → LIKE prefix.
            !input?.tier
              ? sql`1=1`
              : input.tier === "untagged"
                ? isNull(smsMessages.variantKey)
                : sql`${smsMessages.variantKey} LIKE ${input.tier + '%'}`,
          ))
          .orderBy(desc(smsMessages.createdAt))
          .limit(limit);

        return rows.map((r: Row) => {
          // wave-181.60-followup (audit · 2026-05-18 PM) · PII fix.
          // Pre-fix the full phone was returned in the spread alongside
          // phoneSuffix · admin client never rendered it but it was on
          // the wire. Now: destructure phone out so only the masked
          // suffix is serialized.
          const { phone, ...rest } = r;
          return {
            ...rest,
            phoneSuffix: (phone || "").replace(/\D/g, "").slice(-4),
            tier: prettyTier(rollupKey(r.variantKey)),
          };
        });
      } catch (err) {
        log.warn("recentSends failed", { error: err instanceof Error ? err.message : String(err) });
        return [];
      }
    }),
});
