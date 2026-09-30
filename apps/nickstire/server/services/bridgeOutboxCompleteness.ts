/**
 * bridge_outbox completeness — the ADR-0019 §9 phase-1 comparison, read-only
 * (docs/adr/0019-idempotent-bridge-writes.md), queue item Q-12 phase 1c.
 *
 * Phase 1 records every StateNour-bound bus event as a `shadow` row
 * (services/bridgeOutbox.ts). Before any family is cut over to a drainer, §9
 * asks: for each day, do the business rows in `leads`, `bookings`, callbacks
 * and emergencies each have their outbox row? Target: 0 missing, 0 extra.
 *
 * The expected key for a business row is built with the SAME `bridgeKey` the
 * enqueue uses, so "missing" means exactly "no outbox row carries this row's
 * key", never a formatting mismatch.
 *
 * What the counts mean:
 *   · missing — a business row with no outbox row. Either the event was lost,
 *     or the lane that inserted the row never emits the bus event at all
 *     (several lead lanes insert without emitting). `missingBySource` splits
 *     leads by their `source` column so the two can be told apart.
 *   · extra — an outbox row whose object id is not a business row in the
 *     window: an emit for a row that was never persisted (or was deleted).
 *
 * Never a confident zero: before 0137 is applied the report says
 * `table_missing`; with the shadow flag OFF it says `not_measuring`, because
 * zero shadow rows then mean "nothing recorded", not "everything missing".
 * Counts only: no names, phones or payloads leave this module.
 */
import { createLogger } from "../lib/logger";
import { isMissingTableError } from "../lib/dbErrors";
import { bridgeKey } from "./bridgeKeys";

const log = createLogger("bridge-outbox-completeness");

/** One §9 family: its business table and the outbox key its rows should carry. */
export type Family = "leads" | "bookings" | "callbacks" | "emergencies";

/** Event type + key kind, exactly as BUS_EVENT_REGISTRY in bridgeOutbox.ts writes them. */
const FAMILY_KEYS: Record<Family, { eventType: string; kind: string }> = {
  leads: { eventType: "lead.created", kind: "lead" },
  bookings: { eventType: "shop.booking.created", kind: "booking" },
  callbacks: { eventType: "lead.callback_requested", kind: "callback" },
  emergencies: { eventType: "lead.emergency", kind: "emergency" },
};

/**
 * A business row as the SQL returns it. `day` and `inWindow` are computed in
 * SQL, not JS: TiDB stores UTC, and driver-parsed times come back shifted
 * (apps/nickstire/AGENTS.md §5 "Time").
 */
type SourceRow = { id: number; day: string | null; inWindow: number | boolean | null; source?: string | null };

export type DayCounts = {
  /** The shop's calendar day (America/New_York) of the business row, YYYY-MM-DD. */
  day: string;
  source: number;
  matched: number;
  missing: number;
  /** Missing rows split by the business row's `source` column ("unknown" when null). */
  missingBySource: Record<string, number>;
};

export type FamilyReport = {
  family: Family;
  eventType: string;
  days: DayCounts[];
  source: number;
  matched: number;
  missing: number;
  extra: number;
};

export type CompletenessReport =
  | { state: "no_db" }
  | { state: "table_missing" }
  | { state: "error"; family: Family | "bridge_outbox" }
  | {
      state: "measured" | "not_measuring";
      shadowEnabled: boolean;
      windowDays: number;
      /** When the report was read (ISO). The window is the last `windowDays` x 24 h before it. */
      asOf: string;
      families: FamilyReport[];
      totals: { source: number; matched: number; missing: number; extra: number };
    };

/**
 * Compare one family's business rows against the outbox keys of its event type.
 * Pure. Only `inWindow` rows are counted; the rest (one extra day before the
 * window) are context, so an outbox row for a row created just before the
 * window edge is not counted as extra.
 */
function compareFamily(family: Family, all: readonly SourceRow[], outboxKeys: readonly string[]): FamilyReport {
  const { eventType, kind } = FAMILY_KEYS[family];
  const keys = new Set(outboxKeys);
  const days = new Map<string, DayCounts>();
  const known = new Set<string>();
  let matched = 0;
  let missing = 0;

  for (const row of all) {
    const key = bridgeKey(eventType, kind, row.id);
    if (!key) continue; // not a usable id; the enqueue could not key it either
    known.add(key);
    // A SQL comparison comes back as 1/0; never trust truthiness ("0" is truthy).
    if (Number(row.inWindow) !== 1) continue;
    const day = row.day || "unknown";
    let d = days.get(day);
    if (!d) {
      d = { day, source: 0, matched: 0, missing: 0, missingBySource: {} };
      days.set(day, d);
    }
    d.source++;
    if (keys.has(key)) {
      d.matched++;
      matched++;
    } else {
      d.missing++;
      missing++;
      const src = row.source || "unknown";
      d.missingBySource[src] = (d.missingBySource[src] ?? 0) + 1;
    }
  }

  let extra = 0;
  for (const k of keys) if (!known.has(k)) extra++;

  return {
    family,
    eventType,
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    source: matched + missing,
    matched,
    missing,
    extra,
  };
}

/**
 * The §9 phase-1 comparison over the last `windowDays` days. Read-only: two
 * SELECTs per family. Returns a state, never throws.
 */
export async function bridgeOutboxCompleteness(
  opts: { windowDays?: number } = {},
): Promise<CompletenessReport> {
  const windowDays = Math.min(Math.max(Math.floor(opts.windowDays ?? 7), 1), 14);
  const asOf = new Date().toISOString();

  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) return { state: "no_db" };

  const { and, inArray, sql } = await import("drizzle-orm");
  const { bridgeOutbox, leads, bookings, callbackRequests, emergencyRequests } = await import(
    "../../drizzle/schema"
  );

  // 1. The outbox side. created_at is indexed; occurred_at is not.
  let outboxRows: Array<{ key: string; eventType: string }>;
  try {
    outboxRows = await db
      .select({ key: bridgeOutbox.idempotencyKey, eventType: bridgeOutbox.eventType })
      .from(bridgeOutbox)
      .where(
        and(
          sql`${bridgeOutbox.createdAt} >= NOW() - INTERVAL ${windowDays} DAY`,
          inArray(
            bridgeOutbox.eventType,
            Object.values(FAMILY_KEYS).map((f) => f.eventType),
          ),
        ),
      );
  } catch (err) {
    if (isMissingTableError(err)) return { state: "table_missing" };
    log.warn("bridge_outbox completeness: outbox read failed");
    return { state: "error", family: "bridge_outbox" };
  }

  // 2. The business side, per family: the window plus one day of context.
  // Day and window are computed in SQL on the stored UTC value.
  const dayOf = (col: unknown) => sql<string>`DATE_FORMAT(CONVERT_TZ(${col}, '+00:00', 'America/New_York'), '%Y-%m-%d')`;
  const inWindowOf = (col: unknown) => sql<number>`${col} >= NOW() - INTERVAL ${windowDays} DAY`;
  const since = (col: unknown) => sql`${col} >= NOW() - INTERVAL ${windowDays + 1} DAY`;
  const readers: Record<Family, () => Promise<SourceRow[]>> = {
    leads: () =>
      db
        .select({ id: leads.id, day: dayOf(leads.createdAt), inWindow: inWindowOf(leads.createdAt), source: leads.source })
        .from(leads)
        .where(since(leads.createdAt)),
    bookings: () =>
      db
        .select({ id: bookings.id, day: dayOf(bookings.createdAt), inWindow: inWindowOf(bookings.createdAt) })
        .from(bookings)
        .where(since(bookings.createdAt)),
    callbacks: () =>
      db
        .select({
          id: callbackRequests.id,
          day: dayOf(callbackRequests.createdAt),
          inWindow: inWindowOf(callbackRequests.createdAt),
          source: callbackRequests.sourcePage,
        })
        .from(callbackRequests)
        .where(since(callbackRequests.createdAt)),
    emergencies: () =>
      db
        .select({
          id: emergencyRequests.id,
          day: dayOf(emergencyRequests.createdAt),
          inWindow: inWindowOf(emergencyRequests.createdAt),
          source: emergencyRequests.source,
        })
        .from(emergencyRequests)
        .where(since(emergencyRequests.createdAt)),
  };

  const families: FamilyReport[] = [];
  for (const family of Object.keys(FAMILY_KEYS) as Family[]) {
    let all: SourceRow[];
    try {
      all = await readers[family]();
    } catch {
      log.warn("bridge_outbox completeness: business read failed", { family });
      return { state: "error", family };
    }
    const keys = outboxRows.filter((r) => r.eventType === FAMILY_KEYS[family].eventType).map((r) => r.key);
    families.push(compareFamily(family, all, keys));
  }

  const { isEnabled } = await import("./featureFlags");
  const shadowEnabled = await isEnabled("bridge_outbox_shadow");
  const totals = families.reduce(
    (t, f) => ({
      source: t.source + f.source,
      matched: t.matched + f.matched,
      missing: t.missing + f.missing,
      extra: t.extra + f.extra,
    }),
    { source: 0, matched: 0, missing: 0, extra: 0 },
  );

  return {
    // Flag OFF with no rows is "not recording", not "everything missing". Rows
    // present with the flag OFF (turned off mid-window) are still reported.
    state: shadowEnabled || outboxRows.length > 0 ? "measured" : "not_measuring",
    shadowEnabled,
    windowDays,
    asOf,
    families,
    totals,
  };
}
