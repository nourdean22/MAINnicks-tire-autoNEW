/**
 * Expected-arrivals service (NCSOS business-action-tools).
 *
 * Captures an EXPECTED ARRIVAL as a durable record. The shop is FCFS and
 * drop-off-preferred, so this is NOT a booking (operator directive: voice/SMS
 * don't mint bookings) and NOT a lead (sms-no-lead-noise) — it is a planning
 * signal the shop can see on the Today screen and later reconcile to a real
 * arrival / invoice. It makes the bookSlot/scheduleDropoff "phantom" real:
 * agenticAuditor flagged "dropoff promised but not persisted".
 *
 * WHAT A ROW IS, measured 2026-09-22 rather than assumed. This header used to
 * say "the customer said they're coming". In production every row for 30 days
 * came from voice (116; SMS has written ONE row in its life), and the voice
 * writer is the bookSlot tool handler — which the prompt makes MANDATORY as
 * "the lead record for any non-tire walk-in", fires in parallel with every
 * transfer, and hardcodes preferredDay "today" in two scripts. So a row means
 * "the assistant recorded an expected walk-in"; whether the CUSTOMER stated an
 * intent is only signalled by `whenText`, the day phrase they actually used
 * (present on 23 of the 89 rows that expired unmet). Readers that turn an
 * expired row into a claim about the customer — a "no-show rate", a "said they
 * were coming" queue reason — are overstating their evidence. 15 of 116 rows
 * reconciled to an invoice inside the window; the other 89 had no invoice under
 * that phone in ±7 or +14 days, and 77 of them none ever.
 */
import { createLogger } from "../lib/logger";
import { affectedRowCount } from "../lib/db-affected";
import { isDuplicateKeyError } from "../lib/dbErrors";
import { phoneLast10 } from "../lib/phone";
import { planArrivalReconciliation } from "../lib/arrivalReconciliationPlan";

const log = createLogger("expected-arrivals");

const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Format a Date as YYYY-MM-DD in the shop's timezone (Cleveland / ET). */
export function toShopDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/**
 * Parse a free-text "when" ("today", "this afternoon", "tomorrow", "monday") into
 * a YYYY-MM-DD date in the shop's timezone. Defaults to TODAY — drop-offs are
 * same-day-dominant, and an ambiguous phrase should never push the expectation
 * into the future. Pure + timezone-correct so it is unit-testable.
 */
export function parseExpectedDate(preferredDay: string | undefined, now: Date = new Date()): string {
  const today = toShopDateStr(now);
  if (!preferredDay) return today;
  const p = preferredDay.trim().toLowerCase();
  if (!p || p === "today" || /\b(this (morning|afternoon|evening)|tonight|now|later|asap|right now)\b/.test(p)) return today;
  if (p === "tomorrow" || p.includes("tomorrow")) return toShopDateStr(new Date(now.getTime() + 86_400_000));
  const targetIdx = DOW.findIndex((d) => p.includes(d));
  if (targetIdx >= 0) {
    const todayWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(now).toLowerCase();
    const todayIdx = DOW.indexOf(todayWeekday);
    // Next occurrence of the named weekday; "monday" said on a Monday means next Monday.
    const daysAhead = ((targetIdx - todayIdx + 7) % 7) || 7;
    return toShopDateStr(new Date(now.getTime() + daysAhead * 86_400_000));
  }
  return today;
}

/**
 * Detect whether an inbound SMS says the customer is coming / dropping off, and
 * pull out the "when" phrase. Precision-biased: a false positive clutters the
 * board (mildly — it expires to no_show), a false negative just misses a capture
 * (no harm). NEGATION suppresses it — "can't make it" / "not coming" / "reschedule"
 * is a decline the cancel/human path owns, not an arrival.
 */
export function detectArrivalIntent(body: string): { isArrival: boolean; whenText?: string } {
  const b = (body || "").toLowerCase();
  if (!b.trim()) return { isArrival: false };
  if (/\b(not|n'?t|cannot|can'?t|cant|won'?t|wont|never|no longer|reschedul|another day|different day|maybe later|can i come)\b/.test(b)) {
    return { isArrival: false };
  }
  // Asking WHETHER they may come is not saying they will. The guard above only
  // covered the "can i come" phrasing, so "can I drop off my car?" — a policy
  // question — was recorded as a real expected arrival, which then reconciled to
  // a no_show and quietly inflated the arrival metric. Scoped to a modal +
  // pronoun sitting just before an arrival verb, so a genuine commitment that
  // happens to contain a later question ("I'll be there at 3, can I pay by
  // card?") still counts.
  if (/\b(can|could|may|should|do|does)\s+(i|we|you)\b[^.?!]{0,20}?\b(come|drop|bring|swing|stop|head|pull|tow|be there)\b/.test(b)) {
    return { isArrival: false };
  }
  const arrival = /\b(com(e|ing) (by|in|on|over|down|today|tomorrow|now|through|out)|come by|be there|on (my|the) way|omw|head(ing|ed)? (over|in|down|your way)|stop(ping)? by|drop(ping)? (it|the car|my car|off|by)|i'?ll (come|be|drop|swing|stop|bring|head|pull)|swing(ing)? by|pull(ing)? up|see (you|ya) (today|soon|tomorrow|in a bit)|bring(ing)? (it|the car|my car) (in|by|today|tomorrow)|on my way)\b/;
  if (!arrival.test(b)) return { isArrival: false };
  const when = b.match(/\b(today|tomorrow|this (morning|afternoon|evening)|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  return { isArrival: true, whenText: when?.[0] };
}

export interface RecordExpectedArrivalInput {
  phone: string;
  name?: string | null;
  vehicle?: string | null;
  service?: string | null;
  preferredDay?: string | null;
  source: "voice" | "sms" | "web" | "manual";
  sourceRef?: string | null;
  note?: string | null;
}

/**
 * Record (or update) an expected arrival. Dedups to at-most-one active row per
 * (phone, day): a customer who says "coming today" twice gets ONE record, updated
 * — not a duplicate. Returns null if the DB is unavailable or the phone is unusable.
 */
export async function recordExpectedArrival(input: RecordExpectedArrivalInput): Promise<{ id: number; created: boolean } | null> {
  const phone = (input.phone || "").replace(/\D/g, "").slice(-10);
  if (phone.length < 10) return null;
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return null;
    const expectedDate = parseExpectedDate(input.preferredDay ?? undefined);

    const [existingRows] = await db.execute(sql`
      SELECT id FROM expected_arrivals
      WHERE customerPhone = ${phone} AND expectedDate = ${expectedDate} AND status = 'expected'
      LIMIT 1`);
    const existing = (existingRows as Array<{ id: number }>)[0];
    if (existing) {
      await db.execute(sql`
        UPDATE expected_arrivals SET
          customerName = COALESCE(${input.name ?? null}, customerName),
          vehicle      = COALESCE(${input.vehicle ?? null}, vehicle),
          service      = COALESCE(${input.service ?? null}, service),
          whenText     = COALESCE(${input.preferredDay ?? null}, whenText),
          sourceRef    = COALESCE(${input.sourceRef ?? null}, sourceRef),
          note         = COALESCE(${input.note ?? null}, note)
        WHERE id = ${existing.id}`);
      log.info("expected arrival updated", { id: existing.id, phone4: phone.slice(-4), expectedDate });
      return { id: existing.id, created: false };
    }

    const [res] = await db.execute(sql`
      INSERT INTO expected_arrivals
        (customerName, customerPhone, vehicle, service, expectedDate, whenText, source, sourceRef, note, status)
      VALUES
        (${input.name ?? null}, ${phone}, ${input.vehicle ?? null}, ${input.service ?? null}, ${expectedDate},
         ${input.preferredDay ?? null}, ${input.source}, ${input.sourceRef ?? null}, ${input.note ?? null}, 'expected')`);
    const id = Number((res as { insertId?: number }).insertId);
    log.info("expected arrival recorded", { id, phone4: phone.slice(-4), expectedDate, source: input.source });
    return { id, created: true };
  } catch (err) {
    log.warn("recordExpectedArrival failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** List expected arrivals for a day (default today), for the admin Today screen. */
export async function listExpectedArrivals(opts: { date?: string; includeAllStatuses?: boolean; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return [];
    const date = opts.date ?? parseExpectedDate("today");
    const limit = opts.limit ?? 100;
    const statusFilter = opts.includeAllStatuses ? sql`` : sql`AND status = 'expected'`;
    const [rows] = await db.execute(sql`
      SELECT id, customerName, customerPhone, vehicle, service,
             DATE_FORMAT(expectedDate, '%Y-%m-%d') AS expectedDate, whenText, source, status,
             DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i') AS createdAt
      FROM expected_arrivals
      WHERE expectedDate = ${date} ${statusFilter}
      ORDER BY createdAt DESC LIMIT ${limit}`);
    return rows as Array<Record<string, unknown>>;
  } catch (err) {
    log.warn("listExpectedArrivals failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

export interface ReconcileArrivalsResult {
  /** Rows moved expected -> arrived, each holding a DISTINCT invoice. */
  reconciled: number;
  /** Same-visit rows (earlier days, same customer, same invoice) closed as cancelled. */
  superseded: number;
  /** The unique index rejected our claim: a concurrent run got there first. */
  skippedAlreadyClaimed: number;
}

/**
 * Reconcile arrivals: an expected row becomes `arrived` when an invoice exists
 * for that phone dated on/after the expected day, inside a 3-day window (a
 * drop-off can finish a day or two later). Match by last-10 digits.
 *
 * NOT "a PAID invoice", which is what this comment used to claim. The join has
 * never filtered paymentStatus and should not start: that column is unreliable
 * as a signal (2026-08-28), and every reconciled invoice on 2026-09-22 happened
 * to be `paid` by coincidence, not by constraint. An invoice existing is the
 * evidence of an arrival; whether it was paid is a separate fact.
 *
 * ONE INVOICE, ONE ARRIVAL. This used to be a single UPDATE ... JOIN, and it
 * stamped every eligible row with the invoice — three "coming today" rows for
 * one Wednesday visit became three `arrived` rows sharing one
 * reconciledInvoiceId, which the weekly digest then summed three times. The SQL
 * below still decides which pairs are ELIGIBLE (same phone, in-window, invoice
 * not already claimed) so the day-boundary semantics are unchanged and stay in
 * the database's timezone; the planner decides which eligible pairs are APPLIED,
 * deterministically. Migration 0126 makes the database refuse a second claim,
 * and a rejection there is read as "already claimed", not as a failed write.
 *
 * Idempotent — only touches rows still 'expected'.
 */
export async function reconcileExpectedArrivals(): Promise<ReconcileArrivalsResult> {
  const nothing: ReconcileArrivalsResult = { reconciled: 0, superseded: 0, skippedAlreadyClaimed: 0 };
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return nothing;

    // Dates and timestamps are formatted IN SQL: driver-parsed TiDB dates arrive
    // skewed on this stack, and the planner must compare the same day strings
    // the database used to decide the window.
    const [rows] = await db.execute(sql`
      SELECT ea.id AS arrivalId,
             DATE_FORMAT(ea.expectedDate, '%Y-%m-%d') AS expectedDate,
             UNIX_TIMESTAMP(ea.createdAt) AS createdTs,
             i.id AS invoiceId,
             DATE_FORMAT(i.invoiceDate, '%Y-%m-%d') AS invoiceDate
      FROM expected_arrivals ea
      JOIN invoices i
        ON RIGHT(REGEXP_REPLACE(i.customerPhone, '[^0-9]', ''), 10) = ea.customerPhone
       AND i.invoiceDate >= ea.expectedDate
       AND i.invoiceDate < DATE_ADD(ea.expectedDate, INTERVAL 3 DAY)
      WHERE ea.status = 'expected' AND ea.expectedDate <= ${toShopDateStr(new Date())}
        AND NOT EXISTS (
          SELECT 1 FROM expected_arrivals claimed WHERE claimed.reconciledInvoiceId = i.id
        )`);
    const pairs = (rows as Array<Record<string, unknown>>).map((r) => ({
      arrivalId: Number(r.arrivalId),
      expectedDate: String(r.expectedDate),
      createdTs: Number(r.createdTs),
      invoiceId: Number(r.invoiceId),
      invoiceDate: String(r.invoiceDate),
    }));
    if (pairs.length === 0) return nothing;

    const plan = planArrivalReconciliation(pairs);
    let reconciled = 0;
    let skippedAlreadyClaimed = 0;
    let superseded = 0;

    for (const m of plan.matches) {
      try {
        const res = await db.execute(sql`
          UPDATE expected_arrivals
          SET status = 'arrived', arrivedAt = NOW(), reconciledInvoiceId = ${m.invoiceId}
          WHERE id = ${m.arrivalId} AND status = 'expected' AND reconciledInvoiceId IS NULL`);
        reconciled += affectedRowCount(res);
      } catch (err) {
        // uq_ea_reconciled_invoice (0126) rejected the claim: another run took
        // this invoice between our SELECT and our UPDATE. That is the index
        // doing its job — count it as already claimed, never as a failure.
        if (!isDuplicateKeyError(err)) throw err;
        skippedAlreadyClaimed += 1;
      }
    }

    // Same customer, same invoice, earlier expected day: the visit that
    // happened is the matched row. Leaving these `expected` would let the
    // no-show sweep tell the recovery queue this customer never came — about a
    // customer who came and paid. `cancelled` is the only inert terminal state
    // the enum offers without DDL; the note carries the truth. LEFT(..., 500)
    // because TiDB rejects an over-width write outright and loses the row.
    for (const s of plan.superseded) {
      const res = await db.execute(sql`
        UPDATE expected_arrivals
        SET status = 'cancelled',
            note = LEFT(CONCAT_WS(' | ', note, ${`superseded: same visit as arrival #${s.byArrivalId} (invoice ${s.invoiceId})`}), 500)
        WHERE id = ${s.arrivalId} AND status = 'expected'`);
      superseded += affectedRowCount(res);
    }

    if (reconciled + superseded + skippedAlreadyClaimed > 0) {
      log.info("reconciled expected arrivals", { candidates: pairs.length, reconciled, superseded, skippedAlreadyClaimed });
    }
    return { reconciled, superseded, skippedAlreadyClaimed };
  } catch (err) {
    log.warn("reconcileExpectedArrivals failed", { error: err instanceof Error ? err.message : String(err) });
    return nothing;
  }
}

/**
 * The two arrival facts the recovery kernel cannot see on a call row, shaped
 * exactly as buildRecoveryQueue's options so a caller can spread them in.
 *
 *   expectedArrivalPhones — phones with an OPEN expectation: still `expected`
 *     and not yet past the reconcile window. This used to mean "expected
 *     TODAY", which made "I'll come by tomorrow" invisible to the kernel and
 *     routed it into recovery a day early.
 *   invoicedOnOrAfter — phone -> day of the most recent invoice an arrival
 *     reconciled to, inside the queue's own window. This is the producer that
 *     `invoicedPhones` never had: an `arrived` row IS an invoice match, so the
 *     reconcile is the natural source for "money in the till".
 *
 * Fails OPEN to empty signals, matching the helper it replaces: if the read
 * breaks, walk-ins fall back into the recovery queue, which is noisier but
 * never drops a real obligation. The reverse default would hide customers.
 */
export async function arrivalSignalsForQueue(cutoff: Date): Promise<{
  openExpectations: ReadonlyMap<string, readonly { sourceRef: string | null; createdAtMs: number }[]>;
  invoicedAfter: ReadonlyMap<string, number>;
}> {
  const empty = {
    openExpectations: new Map<string, { sourceRef: string | null; createdAtMs: number }[]>(),
    invoicedAfter: new Map<string, number>(),
  };
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return empty;
    const last10 = (v: unknown) => phoneLast10(v == null ? null : String(v));

    // "Not past the reconcile window" is a SHOP-LOCAL day, not the TiDB session
    // date. CURDATE() here would have moved the boundary at 7 or 8 pm Eastern.
    const openSince = toShopDateStr(new Date(Date.now() - 3 * 86_400_000));
    const [openRows] = await db.execute(sql`
      SELECT customerPhone, sourceRef, UNIX_TIMESTAMP(createdAt) AS createdTs
      FROM expected_arrivals
      WHERE status = 'expected' AND expectedDate >= ${openSince}`);
    const openExpectations = new Map<string, { sourceRef: string | null; createdAtMs: number }[]>();
    for (const r of openRows as Array<{ customerPhone: unknown; sourceRef: unknown; createdTs: unknown }>) {
      const p = last10(r.customerPhone);
      const ts = Number(r.createdTs);
      if (p.length !== 10 || !Number.isFinite(ts)) continue;
      const list = openExpectations.get(p) ?? [];
      list.push({ sourceRef: r.sourceRef == null ? null : String(r.sourceRef), createdAtMs: ts * 1000 });
      openExpectations.set(p, list);
    }

    // The INSTANT of the latest reconciled invoice, not its day: a visit paid
    // for this morning must not close a new need called in this afternoon.
    const [paidRows] = await db.execute(sql`
      SELECT ea.customerPhone AS phone, UNIX_TIMESTAMP(MAX(i.invoiceDate)) AS invoicedTs
      FROM expected_arrivals ea
      JOIN invoices i ON i.id = ea.reconciledInvoiceId
      WHERE ea.status = 'arrived' AND ea.arrivedAt >= ${cutoff}
      GROUP BY ea.customerPhone`);
    const invoicedAfter = new Map<string, number>();
    for (const r of paidRows as Array<{ phone: unknown; invoicedTs: unknown }>) {
      const p = last10(r.phone);
      const ts = Number(r.invoicedTs);
      if (p.length === 10 && Number.isFinite(ts) && ts > 0) invoicedAfter.set(p, ts * 1000);
    }
    return { openExpectations, invoicedAfter };
  } catch (err) {
    log.warn("arrivalSignalsForQueue failed (queue falls back to recovery)", { error: err instanceof Error ? err.message : String(err) });
    return empty;
  }
}

/**
 * Mark expected arrivals that never materialized (older than `daysStale` and
 * still 'expected') as no_show, so a follow-up path can reach them and the Today
 * screen isn't cluttered with stale expectations.
 */
export async function expireStaleExpectedArrivals(daysStale = 2): Promise<{ expired: number }> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { expired: 0 };
    const res = await db.execute(sql`
      UPDATE expected_arrivals
      SET status = 'no_show'
      WHERE status = 'expected' AND expectedDate < DATE_SUB(CURDATE(), INTERVAL ${sql.raw(String(Math.max(0, Math.floor(daysStale))))} DAY)`);
    const expired = affectedRowCount(res);
    if (expired > 0) log.info(`expired ${expired} stale expected arrivals to no_show`);
    return { expired };
  } catch (err) {
    log.warn("expireStaleExpectedArrivals failed", { error: err instanceof Error ? err.message : String(err) });
    return { expired: 0 };
  }
}
