/**
 * Cron · Weekly Revenue Digest (Mondays · business hours · exactly once)
 *
 * 2026-08-07 estate audit finding: the weekly "intelligence report"
 * (routers/admin/weeklyReport.ts) counts bookings, leads and callbacks but
 * never reads `invoices` — the shop's actual revenue was reported nowhere
 * on a weekly cadence. This job closes that gap.
 *
 * Ground rules (operator directive, 2026-08-07):
 *   · Reads the ALG mirror (`invoices`) ONLY — never ShopDriver/ALG itself.
 *     The mirror is revenue source-of-truth per the 'ALG rules all'
 *     directive (see invoiceReconciliation.getDailyRevenueTruth).
 *   · Revenue = paymentStatus 'paid' rows, same filter as the daily truth.
 *   · totalAmount/partsCost/laborCost are CENTS. Divide by 100 exactly
 *     once, at the query-result edge (liveFeed.ts:124 records the 100x-low
 *     incident that rule comes from).
 *
 * Scheduling contract: registered in the HOURLY (2h) tier with
 * `oncePerShopDay: true` — the ROS-081 pattern. The 24h tier's phase can
 * park outside business hours forever; a 2h tier gets ~7 business-hour
 * chances a day and the per-job claim makes the first Monday tick the only
 * one that runs. The Monday gate below is ET (server clock is UTC —
 * a bare getDay() flips to Tuesday at 8 PM ET).
 *
 * The repeat-revenue share is the headline number: 77% of customers are
 * one-and-done, so the share of weekly dollars from returning customers is
 * the single measure the SMS/winback/loyalty machinery exists to move.
 * Phone match is last-10-digits, the same normalization the
 * expected_arrivals reconcile uses on both sides.
 *
 * Failure posture: a digest of zeros produced by a thrown query is a lie —
 * if any section's query fails, NOTHING is sent and the cron_log details
 * say why. A schema error (bad column/table) is reported as SCHEMA BUG,
 * loudly, per the #1125 distinction — it is a bug, not a quiet condition.
 * An empty week with working queries DOES send ($0 is signal).
 */
import { createLogger } from "../../lib/logger";
import { BUSINESS } from "@shared/business";

const log = createLogger("cron:weekly-revenue-digest");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

export interface WeeklyRevenueDigestData {
  windowStart: Date;
  windowEnd: Date;
  /** Dollars, current 7-day window, paid invoices only. */
  revenue: number;
  invoiceCount: number;
  avgTicket: number;
  parts: number;
  labor: number;
  /** (revenue - parts) / revenue, 0-100. Null when revenue is 0. */
  marginPct: number | null;
  /** Prior 7-day window dollars, for the WoW delta. */
  prevRevenue: number;
  prevInvoiceCount: number;
  /** Percent change vs prior week. Null when prior week is $0. */
  deltaPct: number | null;
  /** Share of this week's dollars from customers with any earlier paid invoice. Null when revenue is 0. */
  repeatPct: number | null;
  newPct: number | null;
  /** Dollars on invoices with no usable phone — unattributable. */
  unknownPct: number | null;
  topServices: Array<{ name: string; revenue: number; count: number }>;
  /** expected_arrivals reconciled to an invoice inside the window (the voice/SMS → paid receipt). */
  arrivalsReconciled: number;
  arrivalsRevenue: number;
}

/** ET weekday gate — the server clock is UTC; BUSINESS.timezone is the shop's. */
export function isShopMonday(now: Date = new Date()): boolean {
  return now.toLocaleString("en-US", { timeZone: BUSINESS.timezone, weekday: "short" }) === "Mon";
}

const toDollars = (cents: unknown): number => Math.round(Number(cents) || 0) / 100;

/** TiDB via drizzle mysql2 returns a tuple — [rows, fields] — from execute(). */
const tupleRows = (raw: unknown): unknown[] => {
  if (Array.isArray(raw) && Array.isArray(raw[0])) return raw[0] as unknown[];
  return Array.isArray(raw) ? raw : [];
};

const pct = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

/** Same schema-error taxonomy as monteCarloForecast/#1125: these are bugs, not conditions. */
const isSchemaBug = (e: unknown): boolean =>
  typeof (e as { code?: string })?.code === "string" &&
  ["ER_BAD_FIELD_ERROR", "ER_BAD_TABLE_ERROR", "ER_PARSE_ERROR"].includes(
    (e as { code: string }).code,
  );

export async function computeWeeklyRevenueDigest(now: Date = new Date()): Promise<WeeklyRevenueDigestData> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) throw new Error("No database");

  const windowEnd = now;
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prevStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Current + prior week in one pass over a 14-day slice.
  const aggRaw = await d.execute(sql`
    SELECT
      SUM(CASE WHEN invoiceDate >= ${windowStart} THEN totalAmount ELSE 0 END) AS curCents,
      SUM(CASE WHEN invoiceDate >= ${windowStart} THEN 1 ELSE 0 END)           AS curCount,
      SUM(CASE WHEN invoiceDate >= ${windowStart} THEN partsCost ELSE 0 END)   AS curPartsCents,
      SUM(CASE WHEN invoiceDate >= ${windowStart} THEN laborCost ELSE 0 END)   AS curLaborCents,
      SUM(CASE WHEN invoiceDate <  ${windowStart} THEN totalAmount ELSE 0 END) AS prevCents,
      SUM(CASE WHEN invoiceDate <  ${windowStart} THEN 1 ELSE 0 END)           AS prevCount
    FROM invoices
    WHERE paymentStatus = 'paid'
      AND invoiceDate >= ${prevStart} AND invoiceDate < ${windowEnd}`);
  const agg = tupleRows(aggRaw)[0] as Record<string, unknown> | undefined;

  const revenue = toDollars(agg?.curCents);
  const invoiceCount = Number(agg?.curCount) || 0;
  const parts = toDollars(agg?.curPartsCents);
  const labor = toDollars(agg?.curLaborCents);
  const prevRevenue = toDollars(agg?.prevCents);
  const prevInvoiceCount = Number(agg?.prevCount) || 0;

  // Repeat-revenue share: this week's paid dollars split by whether the
  // same phone (last-10, both sides normalized identically to the
  // expected_arrivals reconcile) has ANY earlier paid invoice.
  const repeatRaw = await d.execute(sql`
    SELECT
      COALESCE(SUM(cur.totalAmount), 0) AS weekCents,
      COALESCE(SUM(CASE WHEN cur.p10 IS NULL THEN cur.totalAmount ELSE 0 END), 0) AS unknownCents,
      COALESCE(SUM(CASE WHEN cur.p10 IS NOT NULL AND EXISTS (
        SELECT 1 FROM invoices prior
        WHERE prior.paymentStatus = 'paid'
          AND prior.invoiceDate < ${windowStart}
          AND RIGHT(REGEXP_REPLACE(COALESCE(prior.customerPhone, ''), '[^0-9]', ''), 10) = cur.p10
      ) THEN cur.totalAmount ELSE 0 END), 0) AS repeatCents
    FROM (
      SELECT totalAmount,
             NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(customerPhone, ''), '[^0-9]', ''), 10), '') AS p10
      FROM invoices
      WHERE paymentStatus = 'paid'
        AND invoiceDate >= ${windowStart} AND invoiceDate < ${windowEnd}
    ) cur`);
  const rep = tupleRows(repeatRaw)[0] as Record<string, unknown> | undefined;
  const weekCentsNum = Number(rep?.weekCents) || 0;
  const repeatCents = Number(rep?.repeatCents) || 0;
  const unknownCents = Number(rep?.unknownCents) || 0;
  const newCents = Math.max(0, weekCentsNum - repeatCents - unknownCents);

  const topRaw = await d.execute(sql`
    SELECT COALESCE(NULLIF(TRIM(SUBSTRING(serviceDescription, 1, 60)), ''), '(no description)') AS svc,
           SUM(totalAmount) AS cents,
           COUNT(*) AS cnt
    FROM invoices
    WHERE paymentStatus = 'paid'
      AND invoiceDate >= ${windowStart} AND invoiceDate < ${windowEnd}
    GROUP BY svc
    ORDER BY cents DESC
    LIMIT 5`);
  const topServices = (tupleRows(topRaw) as Array<Record<string, unknown>>).map((r) => ({
    name: String(r.svc ?? "(no description)"),
    revenue: toDollars(r.cents),
    count: Number(r.cnt) || 0,
  }));

  // The receipt: voice/SMS "I'll come by" promises that reconciled to a real
  // invoice this week (services/expectedArrivals.reconcileExpectedArrivals).
  const arrivalsRaw = await d.execute(sql`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(i.totalAmount), 0) AS cents
    FROM expected_arrivals ea
    JOIN invoices i ON i.id = ea.reconciledInvoiceId
    WHERE ea.status = 'arrived'
      AND ea.arrivedAt >= ${windowStart} AND ea.arrivedAt < ${windowEnd}`);
  const arr = tupleRows(arrivalsRaw)[0] as Record<string, unknown> | undefined;

  return {
    windowStart,
    windowEnd,
    revenue,
    invoiceCount,
    avgTicket: invoiceCount > 0 ? Math.round(revenue / invoiceCount) : 0,
    parts,
    labor,
    marginPct: revenue > 0 ? Math.round(((revenue - parts) / revenue) * 100) : null,
    prevRevenue,
    prevInvoiceCount,
    deltaPct: prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : null,
    repeatPct: pct(repeatCents, weekCentsNum),
    newPct: pct(newCents, weekCentsNum),
    unknownPct: pct(unknownCents, weekCentsNum),
    topServices,
    arrivalsReconciled: Number(arr?.cnt) || 0,
    arrivalsRevenue: toDollars(arr?.cents),
  };
}

/** Telegram uses parse_mode HTML (telegram.ts sendRaw) — free-text service names must be escaped. */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const money = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

export function buildWeeklyRevenueDigestText(data: WeeklyRevenueDigestData): string {
  const fmtDay = (dt: Date): string =>
    dt.toLocaleDateString("en-US", { timeZone: BUSINESS.timezone, month: "short", day: "numeric" });

  const delta =
    data.deltaPct === null
      ? "no prior-week baseline"
      : `${data.deltaPct >= 0 ? "▲" : "▼"} ${Math.abs(data.deltaPct)}% vs prior week (${money(data.prevRevenue)}, ${data.prevInvoiceCount} jobs)`;

  const lines: string[] = [
    `📈 <b>WEEKLY REVENUE — ${money(data.revenue)}</b>`,
    `${fmtDay(data.windowStart)}–${fmtDay(data.windowEnd)} · ${data.invoiceCount} paid invoices · avg ${money(data.avgTicket)}`,
    delta,
    `Parts ${money(data.parts)} · Labor ${money(data.labor)}${data.marginPct !== null ? ` · Margin ${data.marginPct}%` : ""}`,
  ];

  if (data.repeatPct !== null) {
    lines.push(
      `Repeat customers: <b>${data.repeatPct}%</b> of revenue · New ${data.newPct ?? 0}%${
        (data.unknownPct ?? 0) > 0 ? ` · No-phone ${data.unknownPct}%` : ""
      }`,
    );
  }

  if (data.topServices.length > 0) {
    lines.push("Top services:");
    data.topServices.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${esc(s.name)} — ${money(s.revenue)} (${s.count})`);
    });
  }

  if (data.arrivalsReconciled > 0) {
    lines.push(
      `📞 Voice/SMS arrivals → paid invoices: <b>${data.arrivalsReconciled}</b> (${money(data.arrivalsRevenue)})`,
    );
  }

  if (data.revenue === 0) {
    lines.push("No paid invoices recorded this week — if the shop was open, check the ALG import.");
  }

  lines.push("— Nick's Tire & Auto");
  return lines.join("\n");
}

export async function runWeeklyRevenueDigest(now: Date = new Date()): Promise<ProcessResult> {
  if (!isShopMonday(now)) {
    return { recordsProcessed: 0, details: "skip · not Monday (shop TZ)" };
  }

  let data: WeeklyRevenueDigestData;
  try {
    data = await computeWeeklyRevenueDigest(now);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isSchemaBug(e)) {
      log.error("weekly revenue digest hit a SCHEMA BUG — nothing sent", { error: msg });
      return { recordsProcessed: 0, details: `SCHEMA BUG — ${msg}` };
    }
    log.warn("weekly revenue digest failed — nothing sent", { error: msg });
    return { recordsProcessed: 0, details: `digest failed: ${msg}` };
  }

  const text = buildWeeklyRevenueDigestText(data);
  const { sendTelegram } = await import("../../services/telegram");
  const sent = await sendTelegram(text);
  if (!sent) {
    return { recordsProcessed: 0, details: "digest computed but Telegram send failed" };
  }

  log.info("weekly revenue digest sent", {
    revenue: data.revenue,
    invoices: data.invoiceCount,
    repeatPct: data.repeatPct,
    arrivalsReconciled: data.arrivalsReconciled,
  });
  return {
    recordsProcessed: 1,
    details: `revenue ${money(data.revenue)} · ${data.invoiceCount} invoices · repeat ${data.repeatPct ?? "n/a"}% · arrivals ${data.arrivalsReconciled}`,
  };
}
