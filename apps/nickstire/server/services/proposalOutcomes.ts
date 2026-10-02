/**
 * What happened to the customer AFTER a proposal was decided?
 *
 * WHY (2026-10-02 admin truth pass). 38 of 44 admin_proposals were rejected — booking and
 * callback asks from Nick's calls — and "rejected" was a black hole: nothing showed whether
 * the caller came in anyway, was invoiced, or was never heard from again. That is the only
 * way to tell a correct rejection (handled elsewhere / junk) from a lost customer.
 *
 * For each DECIDED proposal carrying a phone in its payload, by last-10-digit match after
 * the proposal was created:
 *   - invoicedOn: earliest non-refunded invoice dated the same day or later;
 *   - bookedOn:   earliest booking created after it (for an EXECUTED booking proposal this
 *                 includes the booking the approval itself created — that is its outcome);
 *   - callbackOn: earliest callback request created after it.
 * Dates are formatted in SQL (driver-parsed TiDB timestamps shift on ET). Read-only.
 * Set-based: one read of the proposals on screen, then ONE read each of invoices, bookings
 * and callback_requests keyed by the proposals' phone IN-list (a correlated subquery per
 * proposal per table regex-scanned those tables once per row). Cached 5 minutes per id
 * set, because the Approvals list refetches.
 */
import { sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../lib/db-helper";
import { cacheGet, cacheSet } from "../lib/cache";
import { createLogger } from "../lib/logger";
import { readRows } from "../lib/dbResult";

const log = createLogger("services:proposalOutcomes");

const DECIDED = new Set(["rejected", "executed", "failed", "execution_ambiguous"]);
const MAX_IDS = 200;

type Downstream =
  | { readable: true; invoicedOn: string | null; bookedOn: string | null; callbackOn: string | null }
  | { readable: false };

const ts = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v : null;

/**
 * Adds `downstream` to each row: null when undecided or the payload has no phone,
 * `{ readable: false }` when the read failed — never an empty "nothing happened".
 */
export async function withDownstreamOutcomes<T extends { id: string; status: string }>(
  rows: readonly T[],
): Promise<Array<T & { downstream: Downstream | null }>> {
  const ids = rows.filter((r) => DECIDED.has(r.status)).map((r) => r.id).slice(0, MAX_IDS);
  const byId = new Map<string, Downstream>();
  const cacheKey = ids.length
    ? `proposal_downstream_v2:${crypto.createHash("sha1").update([...ids].sort().join(",")).digest("hex")}`
    : null;
  const cached = cacheKey ? await cacheGet<Record<string, Downstream>>(cacheKey) : null;
  if (cached) {
    for (const [id, d] of Object.entries(cached)) byId.set(id, d);
  } else if (ids.length > 0) {
    try {
      const d = await db();
      if (!d) throw new Error("database unavailable");
      const proposals = readRows(await d.execute(sql`
        SELECT p.id AS id,
               ${sql.raw(`RIGHT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(p.payload_json, '$.phone')), '[^0-9]', ''), 10)`)} AS phone,
               DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt
        FROM admin_proposals p
        WHERE p.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `)).flatMap((r) => {
        const phone = typeof r.phone === "string" && /^\d{10}$/.test(r.phone) ? r.phone : null;
        const createdAt = ts(r.createdAt);
        // no usable phone (or creation time) -> no claim either way
        return phone && createdAt ? [{ id: String(r.id), phone, createdAt }] : [];
      });
      if (proposals.length > 0) {
        const phones = [...new Set(proposals.map((p) => p.phone))];
        const since = proposals.map((p) => p.createdAt).sort()[0];
        const inPhones = (col: string) =>
          sql`${sql.raw(`RIGHT(REGEXP_REPLACE(${col}, '[^0-9]', ''), 10)`)} IN (${sql.join(phones.map((p) => sql`${p}`), sql`, `)})`;
        const key = (col: string) => sql.raw(`RIGHT(REGEXP_REPLACE(${col}, '[^0-9]', ''), 10)`);
        const invoices = readRows(await d.execute(sql`
          SELECT ${key("customerPhone")} AS phone, DATE_FORMAT(invoiceDate, '%Y-%m-%d %H:%i:%s') AS at
          FROM invoices
          WHERE paymentStatus <> 'refunded' AND invoiceDate >= DATE(${since})
            AND customerPhone IS NOT NULL AND ${inPhones("customerPhone")}
          ORDER BY invoiceDate ASC LIMIT 5000
        `));
        const bookings = readRows(await d.execute(sql`
          SELECT ${key("phone")} AS phone, DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS at
          FROM bookings
          WHERE createdAt > ${since} AND phone IS NOT NULL AND ${inPhones("phone")}
          ORDER BY createdAt ASC LIMIT 5000
        `));
        const callbacks = readRows(await d.execute(sql`
          SELECT ${key("phone")} AS phone, DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS at
          FROM callback_requests
          WHERE createdAt > ${since} AND phone IS NOT NULL AND ${inPhones("phone")}
          ORDER BY createdAt ASC LIMIT 5000
        `));
        /** Earliest qualifying row's DAY for this phone (rows arrive time-ascending). */
        const firstDay = (rows: Array<Record<string, unknown>>, phone: string, ok: (at: string) => boolean) => {
          for (const r of rows) {
            const at = ts(r.at);
            if (r.phone === phone && at && ok(at)) return at.slice(0, 10);
          }
          return null;
        };
        for (const p of proposals) {
          const createdDay = p.createdAt.slice(0, 10);
          byId.set(p.id, {
            readable: true,
            invoicedOn: firstDay(invoices, p.phone, (at) => at.slice(0, 10) >= createdDay),
            bookedOn: firstDay(bookings, p.phone, (at) => at > p.createdAt),
            callbackOn: firstDay(callbacks, p.phone, (at) => at > p.createdAt),
          });
        }
      }
      // Only a successful read is cached; a failure is retried on the next request.
      if (cacheKey) await cacheSet(cacheKey, Object.fromEntries(byId), 300);
    } catch (err) {
      log.warn("proposal downstream read failed — rendered as unknown", {
        error: err instanceof Error ? err.message : String(err),
      });
      for (const id of ids) byId.set(id, { readable: false });
    }
  }
  return rows.map((r) => ({ ...r, downstream: byId.get(r.id) ?? null }));
}
