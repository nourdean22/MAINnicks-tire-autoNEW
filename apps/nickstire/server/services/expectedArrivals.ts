/**
 * Expected-arrivals service (NCSOS business-action-tools).
 *
 * Captures "the customer said they're coming / dropping off" as a durable record.
 * The shop is FCFS and drop-off-preferred, so this is NOT a booking (operator
 * directive: voice/SMS don't mint bookings) and NOT a lead (sms-no-lead-noise) —
 * it is a planning signal the shop can see on the Today screen and later
 * reconcile to a real arrival / paid invoice. It makes the bookSlot/scheduleDropoff
 * "phantom" real: agenticAuditor flagged "dropoff promised but not persisted".
 */
import { createLogger } from "../lib/logger";
import { affectedRowCount } from "../lib/db-affected";

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

/**
 * Reconcile arrivals: an expected row is "arrived" if a paid invoice exists for
 * that phone dated on/after the expected day, within a 3-day window (a drop-off
 * can finish a day or two later). Match by last-10 digits. Idempotent — only
 * touches rows still 'expected'.
 */
export async function reconcileExpectedArrivals(): Promise<{ reconciled: number }> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { reconciled: 0 };
    const res = await db.execute(sql`
      UPDATE expected_arrivals ea
      JOIN invoices i
        ON RIGHT(REGEXP_REPLACE(i.customerPhone, '[^0-9]', ''), 10) = ea.customerPhone
       AND i.invoiceDate >= ea.expectedDate
       AND i.invoiceDate < DATE_ADD(ea.expectedDate, INTERVAL 3 DAY)
      SET ea.status = 'arrived', ea.arrivedAt = NOW(), ea.reconciledInvoiceId = i.id
      WHERE ea.status = 'expected' AND ea.expectedDate <= CURDATE()`);
    const reconciled = affectedRowCount(res);
    if (reconciled > 0) log.info(`reconciled ${reconciled} expected arrivals to paid invoices`);
    return { reconciled };
  } catch (err) {
    log.warn("reconcileExpectedArrivals failed", { error: err instanceof Error ? err.message : String(err) });
    return { reconciled: 0 };
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
