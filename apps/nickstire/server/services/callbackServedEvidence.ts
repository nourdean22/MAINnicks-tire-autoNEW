/**
 * Was the customer behind an open callback already served some other way?
 *
 * WHY (2026-10-02 admin truth pass). 25 callback_requests sat `new`, 24 of them older than
 * a week, and Today showed each as an equal-weight "call this person" card. Some of those
 * customers had since walked in and paid, or booked. The callback enum (new | called |
 * no-answer | completed) has no honest "served elsewhere" value, and auto-writing
 * `completed` would claim a phone call nobody made — so this does NOT close anything.
 * It returns the evidence; the operator closes the card with one tap.
 *
 * Evidence, by last-10-digit phone match, for callbacks still `new`:
 *   - an invoice (not refunded) dated the SAME DAY or later than the request
 *     (invoiceDate is day-grained from the ALG mirror, so a same-day walk-in counts);
 *   - a booking created after the request.
 *
 * Cost: one bounded query, cached 5 minutes — Today polls its bundle every 30s and this
 * must not ride that cadence against the invoices table.
 */
import { sql } from "drizzle-orm";
import { db } from "../lib/db-helper";
import { cacheGet, cacheSet } from "../lib/cache";

interface CallbackServedEvidence {
  kind: "invoice" | "booking";
  /** ISO date (YYYY-MM-DD) of the earliest qualifying invoice or booking. */
  on: string;
  /** Card copy; Today appends it to the callback's detail line. */
  label: string;
}

const CACHE_KEY = "callback_served_evidence_v1";
const CACHE_TTL_SECONDS = 300;
const MAX_CALLBACKS = 200;

/** Dates are formatted IN SQL: driver-parsed TiDB timestamps come back shifted on ET. */
const isoDay = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

/**
 * Map of callbackId -> earliest served evidence. Throws when the read fails, so the
 * bundle reports the slice unavailable instead of rendering "no evidence" (an unreadable
 * hint must not look like "nobody was served").
 */
export async function getCallbackServedEvidence(): Promise<Record<number, CallbackServedEvidence>> {
  const hit = await cacheGet<Record<number, CallbackServedEvidence>>(CACHE_KEY);
  if (hit) return hit;

  const d = await db();
  if (!d) throw new Error("database unavailable");

  const phoneKey = (col: string) => sql.raw(`RIGHT(REGEXP_REPLACE(${col}, '[^0-9]', ''), 10)`);
  const result = await d.execute(sql`
    SELECT c.id AS id,
           (SELECT DATE_FORMAT(MIN(i.invoiceDate), '%Y-%m-%d') FROM invoices i
             WHERE i.paymentStatus <> 'refunded'
               AND i.invoiceDate >= DATE(c.createdAt)
               AND i.customerPhone IS NOT NULL
               AND ${phoneKey("i.customerPhone")} = ${phoneKey("c.phone")}) AS invoicedOn,
           (SELECT DATE_FORMAT(MIN(b.createdAt), '%Y-%m-%d') FROM bookings b
             WHERE b.createdAt > c.createdAt
               AND ${phoneKey("b.phone")} = ${phoneKey("c.phone")}) AS bookedOn
    FROM callback_requests c
    WHERE c.status = 'new' AND LENGTH(REGEXP_REPLACE(c.phone, '[^0-9]', '')) >= 10
    ORDER BY c.createdAt ASC
    LIMIT ${MAX_CALLBACKS}
  `);
  const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as Array<Record<string, unknown>>;

  const out: Record<number, CallbackServedEvidence> = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const invoiced = isoDay(r.invoicedOn);
    const booked = isoDay(r.bookedOn);
    // An invoice is the stronger fact (paid work happened); a booking is intent.
    if (invoiced) out[Number(r.id)] = withLabel({ kind: "invoice", on: invoiced });
    else if (booked) out[Number(r.id)] = withLabel({ kind: "booking", on: booked });
  }
  await cacheSet(CACHE_KEY, out, CACHE_TTL_SECONDS);
  return out;
}

function withLabel(e: Omit<CallbackServedEvidence, "label">): CallbackServedEvidence {
  return {
    ...e,
    label:
      e.kind === "invoice"
        ? `Invoiced ${e.on} (same day or after the request) — likely served, close if handled`
        : `Booked ${e.on}, after the request — likely handled, close if so`,
  };
}
