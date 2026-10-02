/**
 * Financing click -> who -> did they come in. The attribution ladder the click alone cannot give.
 *
 * WHY (2026-10-02 admin truth pass). 16 production financing clicks, 0 identified: the panel
 * joined clicks to `leads` by sessionId, and leads holds 3 rows. But the same persistent
 * visitor id (localStorage nick_session_id) is also written on bookings, callback requests,
 * tire orders and click-to-call events. This reads all of them, then looks for an invoice for
 * the identified phone on or after the click.
 *
 * Rungs (each only as strong as its evidence — never inferred upward):
 *   CLICK       the financing_clicks row itself
 *   IDENTIFIED  a lead / booking / callback / tire order carrying the same sessionId (+ its phone)
 *   CALLED      a click-to-call event from that session (no phone: intent, not identity)
 *   INVOICED    an invoice for the identified phone dated on/after the click day
 * Provider APPLICATION / APPROVAL are not observable: the providers report nothing back, so
 * those rungs are absent by construction, not zero.
 *
 * Read-only. Dates formatted in SQL (driver-parsed TiDB timestamps shift on ET).
 */
import { sql } from "drizzle-orm";
import { db } from "../lib/db-helper";
import { normalizePhone } from "./revenueAttribution";

interface Attribution {
  identifiedVia: "lead" | "booking" | "callback" | "tire_order" | null;
  identifiedId: number | null;
  calledShop: boolean;
  invoicedOn: string | null;
}

const rowsOf = (result: unknown): Array<Record<string, unknown>> => {
  const r = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return Array.isArray(r) ? (r as Array<Record<string, unknown>>) : [];
};
/** Last 10 digits, or null — the repo's one phone key (revenueAttribution.normalizePhone). */
const phone10 = (v: unknown): string | null => normalizePhone(typeof v === "string" ? v : null);
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Attribution per click id. Throws on a failed read — the caller reports it, never "unattributed". */
export async function financingAttributionFor(clickIds: readonly number[]): Promise<Map<number, Attribution>> {
  const out = new Map<number, Attribution>();
  if (clickIds.length === 0) return out;
  const d = await db();
  if (!d) throw new Error("database unavailable");

  const first = (table: string, col: string) =>
    sql.raw(`(SELECT x.${col} FROM ${table} x WHERE x.sessionId = fc.sessionId ORDER BY x.id ASC LIMIT 1)`);
  const clicks = rowsOf(await d.execute(sql`
    SELECT fc.id AS id, DATE_FORMAT(fc.createdAt, '%Y-%m-%d') AS clickDay,
           ${first("leads", "id")} AS leadId, ${first("leads", "phone")} AS leadPhone,
           ${first("bookings", "id")} AS bookingId, ${first("bookings", "phone")} AS bookingPhone,
           ${first("callback_requests", "id")} AS callbackId, ${first("callback_requests", "phone")} AS callbackPhone,
           ${first("tire_orders", "id")} AS tireOrderId, ${first("tire_orders", "customerPhone")} AS tireOrderPhone,
           EXISTS (SELECT 1 FROM call_events e WHERE e.sessionId = fc.sessionId) AS calledShop
    FROM financing_clicks fc
    WHERE fc.sessionId IS NOT NULL AND fc.id IN (${sql.join(clickIds.map((id) => sql`${id}`), sql`, `)})
  `));

  const phoneByClick = new Map<number, { phone: string; clickDay: string }>();
  for (const c of clicks) {
    const ladder: Array<[Attribution["identifiedVia"], unknown, unknown]> = [
      ["lead", c.leadId, c.leadPhone],
      ["booking", c.bookingId, c.bookingPhone],
      ["callback", c.callbackId, c.callbackPhone],
      ["tire_order", c.tireOrderId, c.tireOrderPhone],
    ];
    const hit = ladder.find(([, id]) => id != null);
    const phone = ladder.map(([, , p]) => phone10(p)).find((p) => p != null) ?? null;
    const id = Number(c.id);
    out.set(id, {
      identifiedVia: hit ? hit[0] : null,
      identifiedId: hit ? Number(hit[1]) : null,
      calledShop: Number(c.calledShop) === 1,
      invoicedOn: null,
    });
    const clickDay = day(c.clickDay);
    if (phone && clickDay) phoneByClick.set(id, { phone, clickDay });
  }

  const phones = [...new Set([...phoneByClick.values()].map((v) => v.phone))];
  if (phones.length > 0) {
    const since = [...phoneByClick.values()].map((v) => v.clickDay).sort()[0];
    const invoices = rowsOf(await d.execute(sql`
      SELECT RIGHT(REGEXP_REPLACE(customerPhone, '[^0-9]', ''), 10) AS phone,
             DATE_FORMAT(invoiceDate, '%Y-%m-%d') AS invoiceDay
      FROM invoices
      WHERE paymentStatus <> 'refunded' AND invoiceDate >= ${since} AND customerPhone IS NOT NULL
        AND RIGHT(REGEXP_REPLACE(customerPhone, '[^0-9]', ''), 10) IN (${sql.join(phones.map((p) => sql`${p}`), sql`, `)})
      ORDER BY invoiceDate ASC
      LIMIT 2000
    `));
    for (const [id, { phone, clickDay }] of phoneByClick) {
      const inv = invoices.find((i) => i.phone === phone && typeof i.invoiceDay === "string" && i.invoiceDay >= clickDay);
      const a = out.get(id);
      if (a && inv) a.invoicedOn = day(inv.invoiceDay);
    }
  }
  return out;
}
