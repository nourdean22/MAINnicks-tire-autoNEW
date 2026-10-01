/**
 * Q-29 · nickstire's daily digest, as StateNour stores it.
 *
 * nickstire's "db-backup" cron used to POST every lead, booking and invoice
 * row from the last 24 h, and /api/sync/backup stored the body verbatim in
 * `audit_events.payload`. Nothing ever read those rows back. The sender now
 * posts counts only; this whitelist is the receiver-side half, so a stale
 * sender (deploy skew, a rollback) cannot land customer rows here again.
 *
 * Only these keys survive, and every count is a non-negative integer or null.
 */

const TOTAL_KEYS = ["leads", "bookings", "invoices", "customers", "tireOrders"] as const;
const RECENT_KEYS = ["leads", "bookings", "invoices"] as const;

type Count = number | null;

export interface DailyDigestPayload {
  kind: "daily_digest";
  date: string | null;
  timestamp: string | null;
  counts: Record<(typeof TOTAL_KEYS)[number], Count>;
  recent24h: Record<(typeof RECENT_KEYS)[number], Count>;
}

function count(value: unknown): Count {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function pickCounts<K extends string>(source: unknown, keys: readonly K[]): Record<K, Count> {
  const obj = source && typeof source === "object" ? (source as Record<string, unknown>) : {};
  const out = {} as Record<K, Count>;
  for (const key of keys) out[key] = count(obj[key]);
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function toDailyDigestPayload(input: unknown): DailyDigestPayload {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    kind: "daily_digest",
    date: typeof body.date === "string" && DATE_RE.test(body.date) ? body.date : null,
    timestamp: typeof body.timestamp === "string" && TIMESTAMP_RE.test(body.timestamp) ? body.timestamp : null,
    counts: pickCounts(body.counts, TOTAL_KEYS),
    recent24h: pickCounts(body.recent24h, RECENT_KEYS),
  };
}
