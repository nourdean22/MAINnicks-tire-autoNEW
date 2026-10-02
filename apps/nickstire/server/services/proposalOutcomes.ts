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
 * One bounded query over the ids on screen, cached 5 minutes per id set: each decided row
 * costs three regex-matched subqueries, and the Approvals list refetches.
 */
import { sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../lib/db-helper";
import { cacheGet, cacheSet } from "../lib/cache";
import { createLogger } from "../lib/logger";

const log = createLogger("services:proposalOutcomes");

const DECIDED = new Set(["rejected", "executed", "failed", "execution_ambiguous"]);
const MAX_IDS = 200;

type Downstream =
  | { readable: true; invoicedOn: string | null; bookedOn: string | null; callbackOn: string | null }
  | { readable: false };

const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

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
    ? `proposal_downstream_v1:${crypto.createHash("sha1").update([...ids].sort().join(",")).digest("hex")}`
    : null;
  const cached = cacheKey ? await cacheGet<Record<string, Downstream>>(cacheKey) : null;
  if (cached) {
    for (const [id, d] of Object.entries(cached)) byId.set(id, d);
  } else if (ids.length > 0) {
    try {
      const d = await db();
      if (!d) throw new Error("database unavailable");
      const phoneOf = sql.raw(`RIGHT(REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(p.payload_json, '$.phone')), '[^0-9]', ''), 10)`);
      const key = (col: string) => sql.raw(`RIGHT(REGEXP_REPLACE(${col}, '[^0-9]', ''), 10)`);
      const result = await d.execute(sql`
        SELECT p.id AS id,
               LENGTH(${phoneOf}) AS phoneLen,
               (SELECT DATE_FORMAT(MIN(i.invoiceDate), '%Y-%m-%d') FROM invoices i
                 WHERE i.paymentStatus <> 'refunded' AND i.invoiceDate >= DATE(p.created_at)
                   AND i.customerPhone IS NOT NULL AND ${key("i.customerPhone")} = ${phoneOf}) AS invoicedOn,
               (SELECT DATE_FORMAT(MIN(b.createdAt), '%Y-%m-%d') FROM bookings b
                 WHERE b.createdAt > p.created_at AND ${key("b.phone")} = ${phoneOf}) AS bookedOn,
               (SELECT DATE_FORMAT(MIN(c.createdAt), '%Y-%m-%d') FROM callback_requests c
                 WHERE c.createdAt > p.created_at AND ${key("c.phone")} = ${phoneOf}) AS callbackOn
        FROM admin_proposals p
        WHERE p.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `);
      const out = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as Array<Record<string, unknown>>;
      for (const r of Array.isArray(out) ? out : []) {
        if (Number(r.phoneLen) !== 10) continue; // no usable phone -> no claim either way
        byId.set(String(r.id), {
          readable: true,
          invoicedOn: day(r.invoicedOn),
          bookedOn: day(r.bookedOn),
          callbackOn: day(r.callbackOn),
        });
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
