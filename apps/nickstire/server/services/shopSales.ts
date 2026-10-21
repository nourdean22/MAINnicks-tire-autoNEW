/**
 * shopSales — ONE definition of "what the shop sold", and the honest gap to the
 * authoritative report.
 *
 * WHY THIS EXISTS. The 2026-09-01 admin audit measured 19 distinct revenue
 * surfaces backed by at least 11 independent implementations of "paid invoice
 * revenue for a period", each rolling its own window arithmetic. Its own fix
 * list proposed a single `paidInvoiceRevenue(period)` helper
 * (docs/admin-surface-audit/code-underneath-audit-data.md fix item 6) and it was
 * never built. This is that helper.
 *
 * WHAT IT DOES NOT CLAIM. It does not claim to be net sales, cash collected, or
 * the shop's authoritative total. It reports ONE transaction set, states the
 * rules that produced it, and — the part that makes it reconcilable rather than
 * merely confident — COUNTS WHAT IT EXCLUDED. A number you cannot reconcile is
 * an opinion; a number shipped next to its exclusions can be checked against an
 * ALG/ShopDriver report line by line.
 *
 * ─── THE TRANSACTION SET, STATED ────────────────────────────────────────────
 *
 * INCLUDED: rows in `invoices` with `paymentStatus = 'paid'` whose `invoiceDate`
 * falls in the window. Amount is `totalAmount`, an INTEGER of CENTS.
 *
 * BASIS: invoice date (accrual — what was billed), NOT payment date. There is no
 * payment-date column on `invoices` at all, so a cash-collected figure is not
 * derivable from this table and must not be implied. Operator decision
 * 2026-09-07: billed is "Sales"; collections is a separate figure.
 *
 * GROSS, TAX-INCLUSIVE. `totalAmount` is an ALG-supplied gross figure.
 * `taxAmount` exists as a column and is NEVER subtracted anywhere in this
 * codebase — and it has been writing 0 since 2026-05 because the mirror consumes
 * a SUMMARY endpoint that carries no parts/labor/tax split. So this is not net
 * sales and cannot be made into net sales from this table.
 *
 * EXCLUDED, and counted so the gap is visible rather than assumed:
 *   · `pending`  — includes ALG tickets still "open". Not a sale yet.
 *   · `partial`  — EXCLUDED ENTIRELY, not partially counted. There is no
 *                  `amountPaid` / `amountDue` column anywhere in the schema, so
 *                  the collected portion of a partial invoice is not knowable.
 *                  Its FULL total is reported in the exclusions so the operator
 *                  can see the maximum possible size of this blind spot.
 *   · `refunded` — excluded, NOT netted. A refund of a prior-period sale never
 *                  reduces any period. There is no `void` status at all, so
 *                  voids are structurally invisible.
 *
 * DEDUPE: `invoices.invoiceNumber` carries a unique index and the ShopDriver
 * mirror upserts on it. Rows written with an empty invoice number would collide;
 * `blankInvoiceNumbers` reports that population rather than assuming it is zero.
 *
 * ─── THE TRAP THIS DELIBERATELY AVOIDS ──────────────────────────────────────
 *
 * `paymentStatus` IS NOT A PAYMENT FACT. `shopDriverMirror.normalizePaymentStatus`
 * maps an ALG TICKET LIFECYCLE string onto the payment enum: "closed" -> paid,
 * "open" -> pending, and anything unknown or empty -> **paid**. On re-import a
 * row can be moved OFF `paid` but never back ON. Every "paid revenue" figure in
 * this repo rests on that mapping, so this helper names it in `caveats` and the
 * UI is expected to surface it rather than quietly inherit it.
 *
 * ─── UNKNOWN IS NOT ZERO ────────────────────────────────────────────────────
 *
 * Returns a discriminated union. There is no numeric field to misread on the
 * unavailable branch, so a caller cannot render a failed read as $0 — the shape
 * makes that a type error rather than a judgement call. This is the contract the
 * admin home already uses for its slices (services/adminBundle.ts) and that the
 * two existing revenue surfaces do NOT (admin-stats shopFloor zeroes on catch;
 * masterIntelligence maps a dead engine to "absent from the score").
 *
 * `throughDate` is the newest invoiceDate among ShopDriver rows, shipped on every
 * successful read. The ALG mirror runs a day behind, so a caller that renders
 * "today's sales" without sync state will show a structural $0 every morning — the
 * exact reason controlCenter.todayPulse deliberately refuses to report sales TODAY.
 * The "today" and "yesterday" periods exist for the owner who wants the day, so
 * every read also carries the durable sync state: `sync` (the newest SUCCESSFUL
 * probe in alg_probe_log) and `windowSynced`. The newest invoice date is NOT that
 * watermark: a manual or booking invoice moves it, and a zero-sale day never does.
 * windowSynced false means "not synced yet": say so instead of printing the $0.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("shop-sales");

/**
 * Bump when the transaction set changes, so a stored figure states its rules.
 * v2 (2026-09-08): rolling windows are completed ET days ending yesterday
 * (7 / 30 dates); v1 ran them to tomorrow exclusive (8 / 31 dates).
 */
export const SALES_DEFINITION_VERSION = "shop-sales-v2-invoice-date-gross-completed-days";

/**
 * The one list of periods. The tRPC input enum (routers/controlCenter.ts) is built
 * from it; the card's chips (client SalesCard.tsx) repeat it by hand, and
 * shopSales.test.ts fails if they drift, because a chip the router rejects is a
 * dead button.
 */
export const SALES_PERIODS = ["today", "yesterday", "last_7d", "last_30d", "month_to_date", "prev_month"] as const;
export type SalesPeriod = (typeof SALES_PERIODS)[number];

export interface SalesExclusions {
  /** Not a sale yet. Includes ALG tickets still "open". */
  pendingCount: number;
  pendingCents: number;
  /** Excluded ENTIRELY — the collected portion is not knowable. Full total. */
  partialCount: number;
  partialCentsFullValue: number;
  /** Excluded, not netted. There is no `void` status in the enum. */
  refundedCount: number;
  refundedCents: number;
  /** Dedupe is on invoiceNumber; blanks would collide. Reported, not assumed. */
  blankInvoiceNumbers: number;
}

type ShopSync =
  | {
      state: "ok";
      /** When the probe started, UTC ISO. */
      lastAt: string;
      /** That instant on the shop's (America/New_York) calendar, yyyy-mm-dd. */
      etDate: string;
      /** ... and on the shop's clock, e.g. "11:42 AM". */
      etTime: string;
    }
  /** The log is readable and holds no successful probe. */
  | { state: "never" }
  /** The log could not be read. Never rendered as synced. */
  | { state: "unreadable"; reason: string };

export type ShopSales =
  | {
      available: false;
      /** Why the read failed. Never accompanied by a number. */
      reason: string;
    }
  | {
      available: true;
      cents: number;
      invoiceCount: number;
      period: SalesPeriod;
      window: { fromISO: string; toISO: string; label: string };
      /**
       * Newest invoiceDate among SHOPDRIVER rows (source = 'shopdriver') only. A same-day
       * manual, booking or Stripe row also moves a plain MAX(invoiceDate), which would make
       * a stale mirror look current. This is a data date, NOT the sync watermark: that is
       * `sync` below.
       */
      throughDate: string | null;
      /** The newest SUCCESSFUL ShopDriver probe in alg_probe_log: the durable sync state. */
      sync: ShopSync;
      /**
       * Has a successful probe run after this window's data could have been complete
       * (after the window ended, or, for a window that includes today, today)? null when the
       * probe log could not be read: unknown is not synced and not unsynced. For a single
       * day, false means "not synced", which a card must not render as $0. Set for EVERY
       * period.
       */
      windowSynced: boolean | null;
      /** A ShopDriver probe is running right now: the card should keep re-reading until it lands. */
      syncInFlight: boolean;
      basis: "invoice_date";
      grossOrNet: "gross_tax_inclusive";
      definitionVersion: string;
      exclusions: SalesExclusions;
      /**
       * FALSE until a figure here has been compared to an ALG/ShopDriver period
       * report. Until then this is internally consistent, not reconciled, and
       * the UI must say so. Flipping this is an operator-verified event, not a
       * code change.
       */
      reconciledToShopReport: false;
      caveats: string[];
    };

const PERIOD_LABEL: Record<SalesPeriod, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last_7d: "Last 7 days",
  last_30d: "Last 30 days",
  month_to_date: "Month to date",
  prev_month: "Last month",
};

// en-CA gives yyyy-mm-dd; the timeZone option does the ET conversion.
const etDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/**
 * Window boundaries as Eastern wall-clock dates.
 *
 * Computed in JS as ET calendar dates and passed to SQL as literals, rather than
 * using a bare `CURDATE()`. apps/nickstire/AGENTS.md: the shop runs on
 * America/New_York and "today" must never come from the DB or server default
 * timezone. A UTC session's CURDATE() is already tomorrow in Cleveland from
 * 20:00 ET, which silently shifts every day-bucket for a quarter of each day.
 *
 * `invoiceDate` is shop-local from ALG, so comparing it to ET calendar dates is
 * the correct pairing. Returns inclusive `from`, exclusive `to`.
 */
export function salesWindow(period: SalesPeriod, now: Date = new Date()): { from: string; to: string } {
  const todayET = etDate(now);
  const [y, m, d] = todayET.split("-").map(Number);

  // Build dates in UTC from ET calendar parts, then format back — this keeps the
  // arithmetic on calendar days and never crosses a DST boundary incorrectly,
  // because we only ever add/subtract whole days to a date-only value.
  const asUTC = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd));
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  const addDays = (dt: Date, n: number) => new Date(dt.getTime() + n * 86400000);

  const today = asUTC(y, m, d);
  const tomorrow = addDays(today, 1);

  switch (period) {
    // 2026-10-21 · single Eastern days, for "what did we sell today / yesterday".
    // Today is offered but never the card's default: the mirror runs a day behind,
    // so `windowSynced` tells the card when the day has no data YET.
    case "today":
      return { from: fmt(today), to: fmt(tomorrow) };
    case "yesterday":
      return { from: fmt(addDays(today, -1)), to: fmt(today) };
    // 2026-09-08 · the rolling windows are COMPLETED Eastern days ending
    // yesterday: [today-7, today) is exactly 7 dates, [today-30, today) exactly
    // 30. Until this fix both ran to TOMORROW (exclusive) and so spanned 8 and
    // 31 dates while their labels said 7 and 30 — caught by an outside review of
    // the merged code, and pinned by the old test as "a 7-day span" whose own
    // literals were eight days apart. Today is excluded on purpose: the ALG
    // mirror runs a day behind, so an "including today" window would always end
    // on a structurally empty day. month_to_date keeps today (that is what
    // "to date" means); prev_month is a whole calendar month.
    case "last_7d":
      return { from: fmt(addDays(today, -7)), to: fmt(today) };
    case "last_30d":
      return { from: fmt(addDays(today, -30)), to: fmt(today) };
    case "month_to_date":
      return { from: fmt(asUTC(y, m, 1)), to: fmt(tomorrow) };
    case "prev_month": {
      const firstThis = asUTC(y, m, 1);
      const lastMonthEnd = firstThis; // exclusive upper bound
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: fmt(asUTC(py, pm, 1)), to: fmt(lastMonthEnd) };
    }
  }
}

/**
 * Has a successful ShopDriver probe run late enough to cover this window?
 *
 * The newest invoice date cannot say: a same-day manual or booking invoice moves it while
 * ShopDriver's rows are stale, and a zero-sale day leaves it where it was however fresh the
 * sync. The durable watermark is the newest SUCCESSFUL probe in alg_probe_log.
 *
 * A window's data can be complete once a probe has run after the window ended; a window that
 * includes today can only ever be "so far", so for it a probe today is the best there is. So
 * the probe's ET date must be at or after min(window end, today): today needs a probe today,
 * yesterday needs one on or after today (it ran after yesterday ended), last month needs one
 * on or after the 1st. yyyy-mm-dd strings compare as calendar days. null: log unreadable.
 */
function windowSyncedFor(window: { to: string }, sync: ShopSync, todayET: string): boolean | null {
  if (sync.state === "unreadable") return null;
  if (sync.state === "never") return false;
  const needed = window.to < todayET ? window.to : todayET;
  return sync.etDate >= needed;
}

/**
 * Turn the "newest successful probe" lookup into a ShopSync. The lookup selects
 * UNIX_TIMESTAMP(startedAt): an exact epoch computed in SQL (startedAt is a TIMESTAMP written
 * by its column default), so no driver-parsed, ET-shifted Date is ever turned into a day
 * (apps/nickstire/AGENTS.md > Time). The ET date and clock are formatted from that instant.
 * No row: "never". A row without a readable epoch: "unreadable", never "never".
 */
function syncFromProbeRows(rows: unknown): ShopSync {
  const head = Array.isArray(rows) ? (Array.isArray(rows[0]) ? rows[0][0] : rows[0]) : rows;
  if (head === undefined || head === null) return { state: "never" };
  const epoch = Number((head as { probeEpoch?: unknown }).probeEpoch);
  if (!Number.isFinite(epoch) || epoch <= 0) return { state: "unreadable", reason: "probe time unreadable" };
  const at = new Date(epoch * 1000);
  return {
    state: "ok",
    lastAt: at.toISOString(),
    etDate: etDate(at),
    etTime: at.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }),
  };
}
/**
 * The single sales read. Every admin surface that wants "what did the shop
 * sell" should call this rather than writing another window.
 */
export async function paidInvoiceRevenue(period: SalesPeriod): Promise<ShopSales> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");

  let db;
  try {
    db = await getDb();
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : "Database handle failed" };
  }
  if (!db) return { available: false, reason: "Database not available" };

  const now = new Date();
  const { from, to } = salesWindow(period, now);

  // Is a probe running right now? Read first and never fatal: it only tells the card to keep
  // following (OAuth callback, chat, a second tab, a manual sync-now and this page-load refresh
  // all count). Unknown is "not following", not an error.
  let syncInFlight = false;
  try {
    const [{ getProbeBudgetState }, { isAdminRefreshProbeInFlight }] = await Promise.all([
      import("./algProbeBudget"),
      import("../lib/adminActivity"),
    ]);
    syncInFlight = getProbeBudgetState().inFlight || isAdminRefreshProbeInFlight();
  } catch (err) {
    log.warn("[shopSales] probe state unreadable", { error: err instanceof Error ? err.message : String(err) });
  }

  try {
    // ORDER MATTERS: the sync watermark is read BEFORE the invoice aggregate. A probe can land
    // between the two reads. This way round the aggregate may already hold the new rows while
    // the watermark still shows the old probe, so we say "not synced" about data that is fresh,
    // which is harmless. In the other order the aggregate could be stale while the watermark
    // names the new probe, and we would say "synced" about data that is not.
    //
    // The watermark is the newest SUCCESSFUL ShopDriver probe: outcome `success` only, which
    // algProbeBudget writes only when the invoice fetch returned rows. (`empty` was also what a
    // failed invoice fetch was logged as; `auth_failed` and `error` read nothing.) Its own try:
    // an unreadable log makes the sync UNKNOWN, it does not make the invoice figures unavailable.
    let sync: ShopSync;
    try {
      sync = syncFromProbeRows(
        await db.execute(sql`
          SELECT UNIX_TIMESTAMP(startedAt) AS probeEpoch
          FROM alg_probe_log
          WHERE outcome = 'success'
          ORDER BY startedAt DESC
          LIMIT 1
        `),
      );
    } catch (err) {
      log.warn("[shopSales] alg_probe_log read failed", { error: err instanceof Error ? err.message : String(err) });
      sync = { state: "unreadable", reason: err instanceof Error ? err.message : "probe log read failed" };
    }

    // One statement. The buckets are computed in SQL over the same window and
    // the same table, so an exclusion count can never disagree with the headline
    // because of a differently-shaped second query.
    const rows = await db.execute(sql`
      SELECT
        COALESCE(SUM(paymentStatus = 'paid'), 0)                              AS paidCount,
        COALESCE(SUM(CASE WHEN paymentStatus = 'paid'      THEN totalAmount ELSE 0 END), 0) AS paidCents,
        COALESCE(SUM(paymentStatus = 'pending'), 0)                           AS pendingCount,
        COALESCE(SUM(CASE WHEN paymentStatus = 'pending'   THEN totalAmount ELSE 0 END), 0) AS pendingCents,
        COALESCE(SUM(paymentStatus = 'partial'), 0)                           AS partialCount,
        COALESCE(SUM(CASE WHEN paymentStatus = 'partial'   THEN totalAmount ELSE 0 END), 0) AS partialCents,
        COALESCE(SUM(paymentStatus = 'refunded'), 0)                          AS refundedCount,
        COALESCE(SUM(CASE WHEN paymentStatus = 'refunded'  THEN totalAmount ELSE 0 END), 0) AS refundedCents,
        COALESCE(SUM(invoiceNumber IS NULL OR invoiceNumber = ''), 0)         AS blankInvoiceNumbers
      FROM invoices
      WHERE invoiceDate >= ${from} AND invoiceDate < ${to}
    `);

    // ShopDriver rows only: a same-day manual or booking invoice must not move the data date.
    const throughRows = await db.execute(sql`SELECT MAX(invoiceDate) AS throughDate FROM invoices WHERE source = 'shopdriver'`);
    const unwrap = (r: unknown): Record<string, unknown> => {
      const arr = Array.isArray(r) ? (r[0] as unknown) : r;
      const list = Array.isArray(arr) ? arr : [arr];
      return (list[0] as Record<string, unknown>) ?? {};
    };
    const agg = unwrap(rows);
    const through = unwrap(throughRows);
    const n = (v: unknown) => Number(v ?? 0);

    const throughRaw = through.throughDate;
    const throughDate = throughRaw ? new Date(throughRaw as string).toISOString().slice(0, 10) : null;
    return {
      available: true,
      cents: n(agg.paidCents),
      invoiceCount: n(agg.paidCount),
      period,
      window: { fromISO: from, toISO: to, label: PERIOD_LABEL[period] },
      throughDate,
      sync,
      syncInFlight,
      windowSynced: windowSyncedFor({ to }, sync, etDate(now)),
      basis: "invoice_date",
      grossOrNet: "gross_tax_inclusive",
      definitionVersion: SALES_DEFINITION_VERSION,
      exclusions: {
        pendingCount: n(agg.pendingCount),
        pendingCents: n(agg.pendingCents),
        partialCount: n(agg.partialCount),
        partialCentsFullValue: n(agg.partialCents),
        refundedCount: n(agg.refundedCount),
        refundedCents: n(agg.refundedCents),
        blankInvoiceNumbers: n(agg.blankInvoiceNumbers),
      },
      reconciledToShopReport: false,
      caveats: [
        "Rolling windows are completed Eastern days ending yesterday (exactly 7 or 30 dates); month-to-date includes today.",
        "Billed, not collected — invoice date basis. There is no payment-date column.",
        "Gross and tax-inclusive; taxAmount is never subtracted and has written 0 since 2026-05.",
        "paymentStatus is an ALG ticket-lifecycle string: unknown or empty maps to 'paid'.",
        "Partial invoices are excluded entirely — the collected portion is not stored.",
        "Refunds are excluded, not netted; there is no void status.",
      ],
    };
  } catch (err) {
    // Never a zeroed payload. An unreadable period is UNKNOWN.
    log.error("[shopSales] paidInvoiceRevenue failed", {
      period,
      error: err instanceof Error ? err.message : String(err),
    });
    return { available: false, reason: err instanceof Error ? err.message : "Query failed" };
  }
}
