/**
 * bridge_outbox, phase 1: SHADOW enqueue — ADR-0019 §4, §5.2, §9
 * (docs/adr/0019-idempotent-bridge-writes.md), queue item Q-12 phase 1b.
 *
 * Every bus event bound for StateNour is recorded as one `status='shadow'` row,
 * keyed by the business fact it describes. Nothing drains shadow rows, and the
 * legacy senders ("nour-os-bridge" and "statenour-sync" in eventBus.ts) run
 * exactly as before. The point is the ADR §9 phase-1 comparison: for each day,
 * shadow rows against `leads` / `bookings` / invoices, target 0 missing and 0
 * duplicates, BEFORE any family is cut over to a drainer.
 *
 * Off unless the `bridge_outbox_shadow` flag is ON. Before migration 0137 is
 * applied, a flag-ON enqueue sees MySQL 1146 and returns "table_missing"
 * (logged), never throws: the flag and the DDL can be turned on in either order.
 *
 * The key registry below is exhaustive over BUSINESS_EVENTS (a Record, so a new
 * bus type without an entry fails typecheck). A type whose emitter does not yet
 * carry the object id the ADR names is registered but UNKEYED: it logs
 * `bridge_outbox unkeyed` with its type and reason, and writes no row. A row
 * keyed on something weaker would dedupe two real events into one, which is
 * the failure the outbox exists to prevent. The unkeyed types are the shadow
 * phase's first finding, not a defect of it.
 */
import { createLogger } from "../lib/logger";
import { affectedRowCount } from "../lib/db-affected";
import { isMissingTableError } from "../lib/dbErrors";
import { bridgeKey } from "./bridgeKeys";
import type { BusinessEvent, EventPayload } from "./eventBus";

const log = createLogger("bridge-outbox");

/** The route every bus event is delivered to (ADR-0019 §2.2 rows #1 and #3). */
const BUS_EVENT_ROUTE = "sync/events";

type Data = Record<string, unknown>;
type Part = string | number | { opaque: string };

type Registered = {
  /** Registry event type, dotted lower_snake (ADR §4). */
  eventType: string;
  /** Latest-wins state (drafts, heartbeats): the newest payload replaces an older one. */
  latestWins?: boolean;
  /** Key parts after the event type, or null when the emitter carries no usable id. */
  parts: (data: Data) => Part[] | null;
};
type Excluded = { excluded: string };

/** A usable object id: a non-empty string or a positive integer. */
function id(value: unknown): string | number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === "string") return value.trim() ? value.trim() : null;
  return null;
}

function obj(kind: string, value: unknown): Part[] | null {
  const v = id(value);
  return v == null ? null : [kind, v];
}

/** Invoice numbers vary in shape ("Invoice# 123", "INV-..."): hash them to letters. */
function opaqueObj(kind: string, value: unknown): Part[] | null {
  const v = id(value);
  return v == null ? null : [kind, { opaque: String(v) }];
}

const BUS_EVENT_REGISTRY: Record<BusinessEvent, Registered | Excluded> = {
  lead_captured: { eventType: "lead.created", parts: (d) => obj("lead", d.id) },
  // routers/callback.ts passes the callback_requests row id (null if the insert failed).
  callback_requested: { eventType: "lead.callback_requested", parts: (d) => obj("callback", d.id) },
  booking_created: { eventType: "shop.booking.created", parts: (d) => obj("booking", d.id) },
  booking_completed: { eventType: "shop.booking.completed", parts: (d) => obj("booking", d.id) },
  // The ADR names the order row id; the emitter carries orderNumber, which is
  // unique per order (routers/gatewayTire.ts regenerates it on a collision).
  tire_order_placed: { eventType: "shop.tire_order.placed", parts: (d) => obj("tire_order", d.orderNumber) },
  invoice_created: { eventType: "shop.invoice.created", parts: (d) => opaqueObj("invoice", d.invoiceNumber) },
  invoice_paid: { eventType: "shop.invoice.paid", parts: (d) => opaqueObj("invoice", d.invoiceNumber) },
  payment_received: { eventType: "shop.payment.received", parts: (d) => obj("order", d.orderNumber) },
  // No estimate emitter carries an estimate id today (routers/estimates.ts).
  estimate_generated: { eventType: "shop.estimate.presented", parts: (d) => obj("estimate", d.id) },
  // routers/emergency.ts passes the emergency_requests row id it persisted.
  emergency_request: { eventType: "lead.emergency", parts: (d) => obj("emergency", d.id) },
  // cron/jobs/reviewMonitor.ts passes stableReviewId(): usually Google's unix
  // review time, 10 digits, which bridgeKey's phone guard would refuse in the clear.
  review_detected: { eventType: "review.received", parts: (d) => opaqueObj("review", d.reviewId) },
  // routers/campaigns.ts carries campaignId; per-customer cross-sell sends do not.
  campaign_sent: { eventType: "comms.campaign.sent", parts: (d) => obj("campaign", d.campaignId) },
  stage_changed: {
    excluded: "a re-entered stage would collide with the earlier key until the emit carries a transition id (ADR §4)",
  },
  social_posted: {
    eventType: "content.social.posted",
    parts: (d) => {
      const draft = id(d.draftId);
      const platform = id(d.platform);
      return draft == null || platform == null ? null : ["draft", draft, platform];
    },
  },
  "social_draft:sync": { eventType: "content.draft.synced", latestWins: true, parts: (d) => obj("draft", d.id) },
  mirror_synced: { eventType: "sync.mirror.completed", latestWins: true, parts: (d) => obj("source", d.source) },
  data_refreshed: { eventType: "sync.data.refreshed", latestWins: true, parts: (d) => obj("source", d.source) },
};

type OutboxEntry =
  | {
      ok: true;
      key: string;
      eventType: string;
      latestWins: boolean;
      occurredAt: Date;
      payload: Record<string, unknown>;
    }
  | { ok: false; reason: "excluded" | "no_object_id" | "key_rejected"; detail?: string };

/** The outbox row a bus event maps to, or why it has none. Pure. */
function outboxEntryFor(event: EventPayload): OutboxEntry {
  const entry = BUS_EVENT_REGISTRY[event.type];
  if (!entry) return { ok: false, reason: "no_object_id", detail: "unregistered_event_type" };
  if ("excluded" in entry) return { ok: false, reason: "excluded", detail: entry.excluded };
  const parts = entry.parts(event.data ?? {});
  if (!parts) return { ok: false, reason: "no_object_id" };
  // bridgeKey refuses a phone-shaped part and anything outside [A-Za-z0-9_.-].
  const key = bridgeKey(entry.eventType, ...parts);
  if (!key) return { ok: false, reason: "key_rejected" };
  const t = new Date(event.timestamp);
  return {
    ok: true,
    key,
    eventType: entry.eventType,
    latestWins: entry.latestWins === true,
    // Dispatch time: the bus carries no separate business time today.
    occurredAt: Number.isNaN(t.getTime()) ? new Date() : t,
    // The body statenour-sync sends today (payload parity, ADR §11 open item 1), plus the key.
    payload: {
      type: `nickstire:${event.type}`,
      timestamp: event.timestamp,
      source: event.source || "nickstire",
      priority: event.priority,
      data: event.data,
      idempotencyKey: key,
    },
  };
}

export type ShadowResult =
  | "disabled"
  | "excluded"
  | "unkeyed"
  | "no_db"
  | "table_missing"
  | "enqueued"
  | "duplicate"
  | "coalesced";

/**
 * Record `event` as a shadow row. Never sends anything. Throws only on an
 * unexpected DB error, so the bus records it in event_dlq like any other
 * destination failure.
 */
export async function shadowEnqueue(event: EventPayload): Promise<ShadowResult> {
  const { isEnabled } = await import("./featureFlags");
  if (!(await isEnabled("bridge_outbox_shadow"))) return "disabled";

  const entry = outboxEntryFor(event);
  if (!entry.ok) {
    // Type and reason only: event.data holds names and phones.
    log.info("bridge_outbox unkeyed", { type: event.type, reason: entry.reason });
    return entry.reason === "excluded" ? "excluded" : "unkeyed";
  }

  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return "no_db";

  const payload = JSON.stringify(entry.payload);
  try {
    if (entry.latestWins) {
      // Coalesce onto the newest state, but only while the row is still a shadow
      // row: a later phase's pending/sent row is never rewritten from here.
      const res = await db.execute(sql`
        INSERT INTO bridge_outbox (idempotency_key, event_type, route, payload, occurred_at, status)
        VALUES (${entry.key}, ${entry.eventType}, ${BUS_EVENT_ROUTE}, ${payload}, ${entry.occurredAt}, 'shadow')
        ON DUPLICATE KEY UPDATE
          payload = IF(status = 'shadow', VALUES(payload), payload),
          occurred_at = IF(status = 'shadow', VALUES(occurred_at), occurred_at)
      `);
      // mysql2: 1 = inserted, 2 = updated, 0 = identical row left as is.
      return affectedRowCount(res) === 1 ? "enqueued" : "coalesced";
    }
    const res = await db.execute(sql`
      INSERT IGNORE INTO bridge_outbox (idempotency_key, event_type, route, payload, occurred_at, status)
      VALUES (${entry.key}, ${entry.eventType}, ${BUS_EVENT_ROUTE}, ${payload}, ${entry.occurredAt}, 'shadow')
    `);
    // 0 = this fact is already recorded: the dedupe the drain phase relies on.
    return affectedRowCount(res) === 1 ? "enqueued" : "duplicate";
  } catch (err) {
    if (isMissingTableError(err)) {
      log.warn("bridge_outbox missing: flag bridge_outbox_shadow is ON but migration 0137 is not applied", {
        type: event.type,
      });
      return "table_missing";
    }
    // Never rethrow the driver error itself: drizzle's message is the SQL plus its
    // bound params, i.e. the payload with names and phones, and the bus copies
    // the message into event_dlq and the Telegram DLQ alert.
    throw new Error(`bridge_outbox shadow insert failed (${driverCode(err)})`);
  }
}

/** The driver's code/errno, walked through drizzle's `cause` wrapper. No message text. */
function driverCode(err: unknown): string {
  let e: unknown = err;
  for (let depth = 0; depth < 4 && e != null && typeof e === "object"; depth++) {
    const x = e as { code?: unknown; errno?: unknown; cause?: unknown };
    if (typeof x.code === "string" || typeof x.errno === "number") {
      return [x.code, x.errno].filter((v) => v != null).join("/");
    }
    e = x.cause;
  }
  return "unknown";
}
