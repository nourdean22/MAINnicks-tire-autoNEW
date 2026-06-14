/**
 * Traffic → Revenue Funnel Router
 *
 * Single-query-per-stage overview of how searchers become paying customers.
 * This is the diagnostic dashboard that makes conversion leaks obvious.
 *
 * Stages (30d default, 7d / 90d also supported):
 *   1. Impressions (GSC)
 *   2. Clicks (GSC)  — with CTR
 *   3. Phone-click tracking events (call_events)
 *   4. Chat sessions (chat_sessions)
 *   5. Form leads (leads)
 *   6. Callbacks (callback_requests)
 *   7. Bookings (bookings)
 *   8. Invoices + revenue (invoices; ALG mirror)
 *
 * Also returns:
 *   - Top 10 queries by clicks with CTR + avg position
 *   - Top 10 landing pages by clicks
 *   - Branded vs non-branded click split
 *   - Leak alerts (hard-coded diagnostic rules)
 *
 * All SQL uses plain template literals with interval-DAY math. No
 * `COUNT(*) as unknown as X` — that bug cost us half a day.
 */

import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { sql, gte } from "drizzle-orm";
import { bookings } from "../../drizzle/schema";
import { normalizePathname } from "@shared/attribution";
import { createLogger } from "../lib/logger";

const log = createLogger("trafficFunnel");

type Range = "7d" | "30d" | "90d";

function rangeToDays(r: Range): number {
  return r === "7d" ? 7 : r === "90d" ? 90 : 30;
}

/** Light wrapper for mysql2's tuple [rows, fields] vs rows-direct. */
async function exec(d: unknown, q: unknown): Promise<Record<string, unknown>[]> {
  const result = (await (d as { execute: (q: unknown) => Promise<unknown> }).execute(q)) as unknown;
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as Record<string, unknown>[];
  }
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return [];
}

function num(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(numer: number, denom: number, decimals = 1): number {
  if (denom <= 0) return 0;
  const p = (numer / denom) * 100;
  return Math.round(p * 10 ** decimals) / 10 ** decimals;
}

interface Stage {
  key: string;
  label: string;
  count: number;
  /** % of the PREVIOUS stage that reached this one. null for the first stage. */
  conversionFromPrev: number | null;
  /** Optional subtitle — shown under the count */
  sub?: string;
  /** Severity: "good" | "warn" | "critical" — drives UI color */
  severity: "good" | "warn" | "critical";
  /** Optional note / explanation shown as a tooltip / inline hint */
  note?: string;
}

export const trafficFunnelRouter = router({
  /**
   * overview — the full funnel snapshot for a given time window.
   * Single call, no N+1. All metrics computed server-side.
   */
  overview: adminProcedure
    .input(
      z.object({
        range: z.enum(["7d", "30d", "90d"]).default("30d"),
      }).optional(),
    )
    .query(async ({ input }) => {
      const range: Range = input?.range ?? "30d";
      const days = rangeToDays(range);

      const d = await getDb();
      if (!d) {
        throw new Error("Database unavailable");
      }

      // ─── PARALLEL FETCH of every stage counter ──────────
      const [
        gscAggRows,
        topQueriesRows,
        topPagesRows,
        callEventsRows,
        chatSessionsRows,
        leadsRows,
        callbacksRows,
        bookingsRows,
        invoicesRows,
        brandedRows,
        algEstimatesRows,
      ] = await Promise.all([
        // GSC aggregate (clicks, impressions) over the last N days.
        // search_performance stores ctr * 100 and position * 100.
        exec(
          d,
          sql`
            SELECT
              COALESCE(SUM(clicks), 0) AS clicks,
              COALESCE(SUM(impressions), 0) AS impressions,
              COALESCE(AVG(position), 0) / 100 AS avgPosition,
              COUNT(DISTINCT date) AS days
            FROM search_performance
            WHERE date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(days))} DAY), '%Y-%m-%d')
          `,
        ),
        exec(
          d,
          sql`
            SELECT
              query,
              SUM(clicks) AS clicks,
              SUM(impressions) AS impressions,
              AVG(position) / 100 AS avgPosition
            FROM search_performance
            WHERE date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(days))} DAY), '%Y-%m-%d')
            GROUP BY query
            ORDER BY clicks DESC
            LIMIT 10
          `,
        ),
        exec(
          d,
          sql`
            SELECT
              page,
              SUM(clicks) AS clicks,
              SUM(impressions) AS impressions
            FROM search_performance
            WHERE date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(days))} DAY), '%Y-%m-%d')
              AND page IS NOT NULL
            GROUP BY page
            ORDER BY clicks DESC
            LIMIT 10
          `,
        ),
        exec(
          d,
          sql`
            SELECT COUNT(*) AS c
            FROM call_events
            WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
          `,
        ),
        exec(
          d,
          sql`
            SELECT COUNT(*) AS c
            FROM chat_sessions
            WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
          `,
        ),
        exec(
          d,
          // Lead-source hygiene: the engagement stage counts PEOPLE who acted
          // on the site. Excluded: callback-linked duplicate leads (the same
          // person is already counted via callback_requests) and booking-auto
          // leads (workOrderAutomation mirrors every booking into leads — those
          // belong to the bookings stage, not site engagement).
          sql`
            SELECT COUNT(*) AS c
            FROM leads
            WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
              AND NOT (source = 'callback' AND callbackId IS NOT NULL)
              AND source <> 'booking'
          `,
        ),
        exec(
          d,
          sql`
            SELECT COUNT(*) AS c
            FROM callback_requests
            WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
          `,
        ),
        exec(
          d,
          sql`
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
            FROM bookings
            WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
          `,
        ),
        exec(
          d,
          sql`
            SELECT
              COUNT(*) AS paid,
              COALESCE(SUM(totalAmount), 0) / 100 AS revenueDollars,
              COALESCE(AVG(totalAmount), 0) / 100 AS avgTicketDollars
            FROM invoices
            WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
              AND paymentStatus = 'paid'
          `,
        ),
        // Branded vs non-branded split: "nick", "tire auto", or "nicks" = branded
        exec(
          d,
          sql`
            SELECT
              SUM(CASE WHEN LOWER(query) REGEXP '(nick|nicks|tire ?and ?auto|tire auto|moes auto)' THEN clicks ELSE 0 END) AS brandedClicks,
              SUM(CASE WHEN LOWER(query) REGEXP '(nick|nicks|tire ?and ?auto|tire auto|moes auto)' THEN 0 ELSE clicks END) AS nonBrandedClicks
            FROM search_performance
            WHERE date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(days))} DAY), '%Y-%m-%d')
          `,
        ),
        exec(
          d,
          sql`
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN matched_invoice_id IS NULL THEN 1 ELSE 0 END) AS declined
            FROM alg_estimates
            WHERE estimate_date >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)
          `,
        ),
      ]);

      // ─── UNPACK COUNTS ────────────────────────────────
      const gsc = gscAggRows[0] ?? {};
      const impressions = num(gsc.impressions);
      const clicks = num(gsc.clicks);
      const avgPosition = num(gsc.avgPosition);
      const gscDaysWithData = num(gsc.days);

      const calls = num(callEventsRows[0]?.c);
      const chats = num(chatSessionsRows[0]?.c);
      const leads = num(leadsRows[0]?.c);
      const callbacks = num(callbacksRows[0]?.c);
      const bookingsTotal = num(bookingsRows[0]?.total);
      const bookingsCompleted = num(bookingsRows[0]?.completed);
      const invoices = num(invoicesRows[0]?.paid);
      const revenue = num(invoicesRows[0]?.revenueDollars);
      const avgTicket = num(invoicesRows[0]?.avgTicketDollars);

      const branded = num(brandedRows[0]?.brandedClicks);
      const nonBranded = num(brandedRows[0]?.nonBrandedClicks);

      const algTotal = num(algEstimatesRows[0]?.total);
      const algDeclined = num(algEstimatesRows[0]?.declined);

      // ─── FUNNEL STAGES with conversion math ───────────
      // Order matters — each stage compares to the previous one to highlight leaks.
      // Callbacks live in ONE stage only (stage 4, as commitment) — counting
      // them in "engaged" too put the same person in the numerator AND the
      // denominator of the stage-4 conversion, inflating it structurally.
      const actions = calls + chats + leads; // "any engagement beyond landing"
      const bookingsPlusCallbacks = bookingsTotal + callbacks;

      const stages: Stage[] = [
        {
          key: "impressions",
          label: "Google Impressions",
          count: impressions,
          conversionFromPrev: null,
          sub: gscDaysWithData > 0 ? `${gscDaysWithData} days of data` : "no GSC data",
          severity: impressions > 0 ? "good" : "critical",
          note: impressions === 0 ? "GSC pipeline may be offline" : undefined,
        },
        {
          key: "clicks",
          label: "Clicks to Site",
          count: clicks,
          conversionFromPrev: pct(clicks, impressions, 2),
          sub: `CTR ${pct(clicks, impressions, 2)}% · avg pos ${avgPosition.toFixed(1)}`,
          severity: clicks > 0 ? "good" : "critical",
        },
        {
          key: "engaged",
          label: "Engaged on Site",
          count: actions,
          conversionFromPrev: pct(actions, clicks),
          sub: `${calls} call clicks · ${chats} chats · ${leads} leads (callbacks counted in the next stage)`,
          // Healthy local shops hit 5–12% clicks→engagement. Under 2% = leak.
          severity: pct(actions, clicks) >= 5 ? "good"
            : pct(actions, clicks) >= 2 ? "warn"
            : "critical",
          note: calls === 0 && clicks > 100
            ? "ZERO call-click tracking events despite 100+ clicks — tracking script likely broken."
            : undefined,
        },
        {
          key: "bookings",
          label: "Bookings + Callbacks",
          count: bookingsPlusCallbacks,
          // No conversion % from "engaged" — bookings include walk-in/phone/
          // voice paths that never pass through site engagement, so the ratio
          // can exceed 100% (it did, the moment the engaged stage stopped
          // double-counting). Same treatment as the invoices stage below.
          conversionFromPrev: null,
          sub: `${bookingsTotal} bookings (${bookingsCompleted} completed) · ${callbacks} callbacks`,
          severity: bookingsPlusCallbacks > 0 ? "good" : "warn",
          note: "Includes walk-in, phone, and voice-agent paths that don't route through site engagement — no honest % exists against the stage above.",
        },
      ];

      // ─── TOP QUERIES (branded detection inline) ──────
      const topQueries = topQueriesRows.map((r) => {
        const query = String(r.query ?? "");
        const isBranded = /(nick|tire ?and ?auto|tire auto|moes auto)/i.test(query);
        return {
          query,
          clicks: num(r.clicks),
          impressions: num(r.impressions),
          ctr: pct(num(r.clicks), num(r.impressions), 2),
          avgPosition: Math.round(num(r.avgPosition) * 10) / 10,
          branded: isBranded,
        };
      });

      const topPages = topPagesRows.map((r) => {
        const page = String(r.page ?? "");
        return {
          page,
          clicks: num(r.clicks),
          impressions: num(r.impressions),
          ctr: pct(num(r.clicks), num(r.impressions), 2),
        };
      });

      // ─── LEAK ALERTS ──────────────────────────────────
      // Hard-coded diagnostic rules that flag obvious problems.
      type Alert = { level: "critical" | "warning" | "info"; title: string; detail: string; fix?: string };
      const alerts: Alert[] = [];

      if (clicks >= 100 && calls === 0) {
        alerts.push({
          level: "critical",
          title: "Call tracking dead",
          detail: `${clicks} clicks in ${days}d but ZERO phone-click events. The tracking script isn't firing.`,
          fix: "Verify /api/call-events endpoint + the client call-tracking wrapper on every tel: link.",
        });
      }
      if (clicks >= 100 && leads === 0 && callbacks <= 1) {
        alerts.push({
          level: "critical",
          title: "Forms not converting",
          detail: `${clicks} site visits → ${leads} leads + ${callbacks} callbacks. That's under 0.5%; a local shop should hit 3–8%.`,
          fix: "Audit BookingPage, Callback widget, TireFinder: broken submit? Missing conversion event? Form too long?",
        });
      }
      if (branded > nonBranded * 2 && impressions > 1000) {
        alerts.push({
          level: "warning",
          title: "Mostly branded traffic",
          detail: `${Math.round((branded / Math.max(branded + nonBranded, 1)) * 100)}% of clicks are people who already know your name. SEO isn't driving NEW discovery.`,
          fix: "Push non-branded pages (services, neighborhoods, problem-based landing pages) harder — improve titles, internal links.",
        });
      }
      if (avgPosition > 15 && impressions > 5000) {
        alerts.push({
          level: "warning",
          title: "Ranking deep on page 2",
          detail: `Average position is ${avgPosition.toFixed(1)} across ${impressions} impressions. Top 10 = page 1 = where clicks happen.`,
          fix: "Identify high-impression low-position queries (page 2), push them to page 1 with content + internal links.",
        });
      }
      if (algTotal === 0) {
        alerts.push({
          level: "info",
          title: "ALG estimate sync hasn't run yet",
          detail: "Walk-in declined-work funnel is invisible until the ALG estimate mirror populates. Sync is wired but shop-protected — it runs only when admin is active.",
        });
      } else if (algDeclined > 0) {
        alerts.push({
          level: "warning",
          title: `${algDeclined} declined walk-in estimates`,
          detail: "Customers got quoted at the counter but walked without getting work done.",
          fix: "Enable FEATURE_DECLINED_RECOVERY=1 to start 7d/30d SMS follow-ups.",
        });
      }

      // ─── SOURCE / META ────────────────────────────────
      return {
        range,
        days,
        generatedAt: new Date().toISOString(),
        stages,
        topQueries,
        topPages,
        branded: {
          branded,
          nonBranded,
          brandedPct: pct(branded, branded + nonBranded),
        },
        alerts,
        /** Raw numbers exposed for custom consumers. */
        raw: {
          impressions,
          clicks,
          avgPosition,
          calls,
          chats,
          leads,
          callbacks,
          bookings: bookingsTotal,
          bookingsCompleted,
          invoices,
          revenue,
          avgTicket,
          algEstimates: algTotal,
          algDeclined,
        },
      };
    }),

  /**
   * topBookingPages — which pages turn into booked jobs (revenue-attribution
   * wave 2026-06). READ-ONLY aggregation over bookings.landingPage, which
   * booking.submit has stamped from sessionStorage UTM capture since the
   * attribution columns shipped (booking.ts insert).
   *
   * HONESTY CONTRACT: landingPage stores the FULL href (utm.ts captures
   * window.location.href) — normalize to pathname BEFORE grouping or counts
   * fragment per UTM variant. Web-form bookings are the only rows that carry
   * attribution; tire-order auto-bookings and phone bookings carry none, so
   * the response includes totalBookings vs withAttribution and the UI must
   * render that coverage line. No PII: only landingPage + counts leave the DB.
   */
  topBookingPages: adminProcedure
    .input(
      z.object({
        range: z.enum(["7d", "30d", "90d"]).default("30d"),
        limit: z.number().int().min(1).max(25).default(10),
      }).optional(),
    )
    .query(async ({ input }) => {
      const range: Range = input?.range ?? "30d";
      const limit = input?.limit ?? 10;
      const days = rangeToDays(range);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const d = await getDb();
      if (!d) {
        return { pages: [], totalBookings: 0, withAttribution: 0, days };
      }

      // Bookings volume is small (hundreds per window) — fetch the single
      // column and normalize/group in Node so pathname normalization is
      // exactly the shared, unit-tested helper. Indexed range scan on
      // createdAt (idx_booking_created).
      const rows = await d
        .select({ landingPage: bookings.landingPage })
        .from(bookings)
        .where(gte(bookings.createdAt, since));

      const counts = new Map<string, number>();
      let withAttribution = 0;
      for (const r of rows) {
        const path = normalizePathname(r.landingPage);
        if (!path) continue;
        withAttribution += 1;
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }

      const pages = [...counts.entries()]
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);

      return { pages, totalBookings: rows.length, withAttribution, days };
    }),
});

log.info("Traffic funnel router ready");
