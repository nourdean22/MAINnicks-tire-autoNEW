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
import { PHONE_MATCH_KEY_SQL } from "../lib/phoneIdentity";
import { buildLoopScoreboard, type LoopRow, type LoopScoreboard } from "../../shared/loopScoreboard";

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
  // wave-149 · also strip the declined-recovery profile suffix (_P1/_P2/_P3)
  // so the 5×3 sequence keys (e.g. "declined_7d_P2") roll up by TOUCH
  // ("declined_7d"), mirroring the existing A/B variant strip ("_v2").
  return variantKey.replace(/_(v|P)\d+$/, "");
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
    // wave-149 · was declined_d7/declined_d30 (digit-LAST) — dead-letter, the
    // cron emits declined_7d/30d (digit-FIRST), and the 5-touch sequence adds
    // 3d/14d/45d. All five now labeled so the SMS-perf tile shows real touch
    // conversion instead of raw keys.
    declined_3d: "Declined-recovery · D3",
    declined_7d: "Declined-recovery · D7",
    declined_14d: "Declined-recovery · D14",
    declined_30d: "Declined-recovery · D30",
    declined_45d: "Declined-recovery · D45",
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
        // Carries the SAME error discriminant the catch block below sets.
        // Pre-fix this path returned a bare empty payload, so a DB outage
        // rendered as "every tier sent zero messages" — the one state an
        // operator must never confuse with a quiet week.
        return {
          windowDays: 30,
          replyWindowDays: REPLY_WINDOW_DAYS,
          conversionWindowDays: CONVERSION_WINDOW_DAYS,
          tiers: [] as { key: string; tier: string; sent: number; replied: number; converted: number; optedOut: number }[],
          error: true as const,
          errorMessage: "Database not available",
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
      // wave-181.65 (audit-181.51 deferred · 2026-05-18 PM)
      // Fail-open with an `error: true` discriminant so the admin UI
      // can distinguish "DB outage / migration pending" from genuine
      // empty results. Pre-fix both states returned identical empty
      // tiers · operator couldn't tell at-a-glance.
      return {
        windowDays: 30,
        replyWindowDays: REPLY_WINDOW_DAYS,
        conversionWindowDays: CONVERSION_WINDOW_DAYS,
        tiers: [] as { key: string; tier: string; sent: number; replied: number; converted: number; optedOut: number }[],
        error: true as const,
        errorMessage: err instanceof Error ? err.message : "Query failed (likely missing 0039 migration)",
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
      // wave-181.65 (audit-181.51 deferred · 2026-05-18 PM)
      // Pre-fix the tier input was unbounded z.string() · an admin
      // could inject `%` / `_` wildcards into the LIKE pattern below
      // and force full-table scans on sms_messages.variantKey. Now
      // restricted to safe chars (alphanumeric + underscore) and
      // capped at 50 chars to match the VARCHAR(50) column.
      tier: z.string().regex(/^[a-z0-9_]{1,50}$/i).optional(),
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

  /**
   * Dollars observed after each loop's sends. THIS IS CORRELATION, NOT
   * ATTRIBUTION — see shared/loopScoreboard.ts for what that means
   * and why the distinction is load-bearing.
   *
   * The join only became possible after the phone-identity repair: sms
   * conversations store whatever format Twilio handed back, customers.phone is
   * written bare-10 by the ShopDriver mirror, and the two never matched. Both
   * sides are normalised to the last 10 digits here via PHONE_MATCH_KEY_SQL so
   * this uses the SAME identity rule as the rest of the app rather than
   * inventing a fourth one.
   *
   * COUNT(DISTINCT i.id) rather than COUNT(*): a customer reached by several
   * sends of the same loop would otherwise have one invoice counted once per
   * send, which inflates a high-frequency loop precisely because it is
   * high-frequency.
   */
  recoveredRevenue: adminProcedure
    .input(z.object({
      windowDays: z.number().int().min(7).max(365).default(180),
      attributionWindowDays: z.number().int().min(1).max(90).default(30),
    }).optional())
    .query(async ({ input }): Promise<LoopScoreboard & { error?: true; errorMessage?: string }> => {
      const windowDays = input?.windowDays ?? 180;
      const attributionWindowDays = input?.attributionWindowDays ?? 30;
      const empty = (errorMessage: string) => ({
        ...buildLoopScoreboard([], { windowDays, attributionWindowDays }),
        error: true as const,
        errorMessage,
      });

      try {
        const d = await db();
        if (!d) return empty("Database not available");

        const [rows] = await d.execute(sql`
          SELECT m.variantKey                                            AS loop,
                 COUNT(DISTINCT m.id)                                    AS sent,
                 COUNT(DISTINCT CASE WHEN m.replyCount > 0 THEN m.id END) AS replied,
                 COUNT(DISTINCT CASE WHEN m.optOutAt IS NOT NULL THEN m.id END) AS optedOut,
                 COUNT(DISTINCT i.id)                                    AS paidInvoicesAfter,
                 COALESCE(SUM(DISTINCT i.totalAmount), 0)                AS revenueObservedCents
          FROM sms_messages m
          JOIN sms_conversations sc ON sc.id = m.conversationId
          LEFT JOIN customers cu
            ON ${sql.raw(PHONE_MATCH_KEY_SQL("cu.phone"))} = ${sql.raw(PHONE_MATCH_KEY_SQL("sc.phone"))}
          LEFT JOIN invoices i
            ON i.customerId = cu.id
           AND i.paymentStatus = 'paid'
           AND i.invoiceDate >  m.createdAt
           AND i.invoiceDate <= DATE_ADD(m.createdAt, INTERVAL ${sql.raw(String(attributionWindowDays))} DAY)
          WHERE m.direction = 'outbound'
            AND m.variantKey IS NOT NULL
            AND m.createdAt >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(windowDays))} DAY)
          GROUP BY m.variantKey
        `);

        // Roll A/B and profile suffixes up to the parent loop, matching
        // summary30d — otherwise the same loop appears as three rows here and
        // one row there, and the two panels visibly disagree.
        const byLoop = new Map<string, LoopRow>();
        for (const raw of rows as Array<Record<string, unknown>>) {
          const key = rollupKey((raw.loop as string | null) ?? null);
          const cur = byLoop.get(key) ?? {
            loop: prettyTier(key), sent: 0, replied: 0, optedOut: 0,
            paidInvoicesAfter: 0, revenueObservedCents: 0,
          };
          cur.sent += Number(raw.sent ?? 0);
          cur.replied += Number(raw.replied ?? 0);
          cur.optedOut += Number(raw.optedOut ?? 0);
          cur.paidInvoicesAfter += Number(raw.paidInvoicesAfter ?? 0);
          cur.revenueObservedCents += Number(raw.revenueObservedCents ?? 0);
          byLoop.set(key, cur);
        }

        return buildLoopScoreboard([...byLoop.values()], { windowDays, attributionWindowDays });
      } catch (err) {
        log.error("recoveredRevenue failed", { error: err instanceof Error ? err.message : String(err) });
        return empty(err instanceof Error ? err.message : "Query failed");
      }
    }),
});
