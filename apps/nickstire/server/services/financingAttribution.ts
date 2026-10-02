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
 * Set-based: one read of the clicks, then ONE read per identity table keyed by the clicks'
 * sessionId IN-list (not a correlated subquery per click per table — most of those tables
 * have no sessionId index), then one invoice read keyed by the phone IN-list.
 * Read-only. Dates formatted in SQL (driver-parsed TiDB timestamps shift on ET).
 */
import { sql } from "drizzle-orm";
import { db } from "../lib/db-helper";
import { normalizePhone } from "./revenueAttribution";
import { readRows } from "../lib/dbResult";

interface Attribution {
  identifiedVia: "lead" | "booking" | "callback" | "tire_order" | null;
  identifiedId: number | null;
  calledShop: boolean;
  invoicedOn: string | null;
}

/** Last 10 digits, or null — the repo's one phone key (revenueAttribution.normalizePhone). */
const phone10 = (v: unknown): string | null => normalizePhone(typeof v === "string" ? v : null);
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Identity ladder, strongest label first. */
const IDENTITY_SOURCES = [
  { via: "lead", table: "leads", phoneCol: "phone" },
  { via: "booking", table: "bookings", phoneCol: "phone" },
  { via: "callback", table: "callback_requests", phoneCol: "phone" },
  { via: "tire_order", table: "tire_orders", phoneCol: "customerPhone" },
] as const;

/** Attribution per click id. Throws on a failed read — the caller reports it, never "unattributed". */
export async function financingAttributionFor(clickIds: readonly number[]): Promise<Map<number, Attribution>> {
  const out = new Map<number, Attribution>();
  if (clickIds.length === 0) return out;
  const d = await db();
  if (!d) throw new Error("database unavailable");
  const inList = (values: readonly (string | number)[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

  const clicks = readRows(await d.execute(sql`
    SELECT fc.id AS id, fc.sessionId AS sessionId, DATE_FORMAT(fc.createdAt, '%Y-%m-%d') AS clickDay
    FROM financing_clicks fc
    WHERE fc.sessionId IS NOT NULL AND fc.id IN (${inList(clickIds)})
  `));
  const sessions = [...new Set(clicks.map((c) => String(c.sessionId ?? "")).filter(Boolean))];
  if (sessions.length === 0) return out;

  // Per identity table: the FIRST row (lowest id) per session, with its phone.
  const firstBySession = new Map<string, Map<string, { id: number; phone: unknown }>>();
  for (const src of IDENTITY_SOURCES) {
    // Table and column names come from the constant above, never from input.
    const head = sql.raw(`SELECT x.sessionId AS sessionId, x.id AS id, x.${src.phoneCol} AS phone FROM ${src.table} x`);
    const rows = readRows(await d.execute(sql`
      ${head}
      WHERE x.sessionId IN (${inList(sessions)})
      ORDER BY x.id ASC
      LIMIT 2000
    `));
    const first = new Map<string, { id: number; phone: unknown }>();
    for (const r of rows) {
      const s = String(r.sessionId ?? "");
      if (s && !first.has(s)) first.set(s, { id: Number(r.id), phone: r.phone });
    }
    firstBySession.set(src.via, first);
  }
  const called = new Set(
    readRows(await d.execute(sql`
      SELECT DISTINCT e.sessionId AS sessionId FROM call_events e WHERE e.sessionId IN (${inList(sessions)})
    `)).map((r) => String(r.sessionId ?? "")),
  );

  const phoneByClick = new Map<number, { phone: string; clickDay: string }>();
  for (const c of clicks) {
    const session = String(c.sessionId ?? "");
    const ladder = IDENTITY_SOURCES.map((src) => ({ via: src.via, hit: firstBySession.get(src.via)?.get(session) }));
    const hit = ladder.find((l) => l.hit != null);
    const phone = ladder.map((l) => phone10(l.hit?.phone)).find((p) => p != null) ?? null;
    const id = Number(c.id);
    out.set(id, {
      identifiedVia: hit ? hit.via : null,
      identifiedId: hit?.hit ? hit.hit.id : null,
      calledShop: called.has(session),
      invoicedOn: null,
    });
    const clickDay = day(c.clickDay);
    if (phone && clickDay) phoneByClick.set(id, { phone, clickDay });
  }

  const phones = [...new Set([...phoneByClick.values()].map((v) => v.phone))];
  if (phones.length > 0) {
    const since = [...phoneByClick.values()].map((v) => v.clickDay).sort()[0];
    const invoices = readRows(await d.execute(sql`
      SELECT RIGHT(REGEXP_REPLACE(customerPhone, '[^0-9]', ''), 10) AS phone,
             DATE_FORMAT(invoiceDate, '%Y-%m-%d') AS invoiceDay
      FROM invoices
      WHERE paymentStatus <> 'refunded' AND invoiceDate >= ${since} AND customerPhone IS NOT NULL
        AND RIGHT(REGEXP_REPLACE(customerPhone, '[^0-9]', ''), 10) IN (${inList(phones)})
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
