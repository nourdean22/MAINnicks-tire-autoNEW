import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getFlag } from "@/lib/feature-flags";
import { sendTelegramWithButtons, editTelegramMessage, InlineButton } from "@/lib/services/telegram";
import { sendPush } from "@/lib/notifications/push";
import { linkVisitToCustomer, renderCustomerLine } from "@/lib/services/vehicle-customer-link";
import { VehicleEventSchema, ALERT_STATES } from "@/lib/services/vehicle-event-contract";
import { hourET } from "@/lib/utils/datetime";
import { ServiceError } from "@/lib/utils/service-error";
import { logger } from "@/lib/logger";

const log = logger.withSurface("services/vehicle-detection");

/**
 * Vehicle-arrival ingest · rewritten 2026-09-08 (ADR-0017, master-plan C7/C9).
 *
 * What changed and why:
 *  · The payload is validated (zod, permissive) — the edge contract v2 adds
 *    `eventId` (idempotency), `visitId` (the business identity minted by the
 *    edge; Frigate track ids fragment on occlusion) and `zoneDwell`. v1
 *    payloads (trackId only) still work.
 *  · Dedupe keys on `visitId` first (12 h window — a car in service is one
 *    visit), then `trackId` (10 min, v1 behaviour).
 *  · A repeated `eventId` is a retry: returns the stored row, alerts nothing.
 *  · Quiet hours (20:00-07:00 ET) suppress arrival alerts; the suppression is
 *    written into the event (`alertSuppressedReason`) so the cockpit can see
 *    the silence. After-hours security alerts belong to camera-intelligence,
 *    not to the arrival lane.
 *  · Cooldown is per camera + zone (was zone only, which crushed a second
 *    camera), and a web-push with tag `arrival:<visit>` rides the existing
 *    PR #1740 flood control next to the Telegram edit-in-place message.
 *  · Nothing here is an LLM: every field is copied or computed.
 *
 * Hardened 2026-10-07 (camera audit, PR #2920):
 *  · The row is written BEFORE the page, with `alertSuppressedReason: "pending"`
 *    until the page completes. It used to be written after: a page sent and
 *    then a failed INSERT (the route answers 5xx, the edge outbox retries)
 *    found no row on the retry and paged again. Now a retry that finds the
 *    marker still "pending" finishes the one page; a retry that finds it
 *    cleared does nothing. The remaining window -- page sent, then the
 *    marking UPDATE fails -- is one UPDATE wide instead of one Telegram call
 *    plus one INSERT wide, and is logged as such.
 *  · The eventId dedupe has a database behind it: a partial UNIQUE index on
 *    (device_id, data->>'eventId') (migrations-pending/20261007120000_...).
 *    Two retries that both pass the findFirst pre-check now race on the
 *    INSERT; the loser's P2002 is answered with the winner's row.
 *  · The visit window is 7 days, not 12 hours: a car dropped Friday evening
 *    and finished Monday is ONE visit. The same migration adds the visitId
 *    expression index that keeps that lookup cheap.
 *
 * Hardened again 2026-10-08 (Codex P1 on #2920): finishing a pending page is a
 * CLAIM, never a read-then-update. Two retries that both found the marker both
 * paged. The writer now records a lease (`alertClaimedAt`) beside the marker; a
 * retry inside the lease does nothing, and one past it takes the row over with a
 * compare-and-swap pinned on the marker and the deadline it read (the marker
 * becomes "paging"), so exactly one caller pages. The clear is pinned the same
 * way, and a lease lost mid-page is logged instead of silently overwritten.
 *
 * And again (Codex P1 on #2931): a retry that finds the page in another caller's
 * hands is answered 503, never 2xx. The edge outbox acknowledges a 2xx for good,
 * so when the holder had died before paging, the retry inside its lease was the
 * last one, and the page was lost. A 503 keeps the retry coming until the marker
 * is cleared (acknowledged) or the lease lapses (it claims the page itself).
 */

// The payload schema lives in vehicle-event-contract.ts (shared with the
// route's non-writing dry-run probe).

/** Edge + cockpit state vocabulary. Unknown states are stored but logged. */
const VEHICLE_STATES = [
  "DETECTED",
  "ENTERED_ZONE",
  "ARRIVAL_CANDIDATE",
  "CONFIRMED_ARRIVAL",
  "IN_SERVICE",
  "DEPARTING",
  "LEFT",
  "PASS_THROUGH",
  "ACKNOWLEDGED",
  "FALSE_POSITIVE",
] as const;

const QUIET_HOURS = { startHourET: 20, endHourET: 7 } as const;
const COOLDOWN_SECONDS = 120;
/**
 * How far back a `visitId` is looked up. Seven days, not twelve hours: the edge mints one
 * visitId per episode and a car can legitimately sit over a weekend, so the window is a scan
 * bound, not a business rule. The expression index on (device_id, data->>'visitId') in
 * migrations-pending/20261007120000_device_events_identity_indexes keeps the lookup cheap.
 */
const VISIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TRACK_WINDOW_MS = 10 * 60 * 1000;
/**
 * `alertSuppressedReason` while the row exists and its page has not completed. A retry that
 * finds this knows the process died between INSERT and page, and finishes the page once.
 */
const ALERT_PENDING = "pending";
/** `alertSuppressedReason` once a RETRY has claimed a pending row's page (the writer's lease lapsed). */
const ALERT_PAGING = "paging";
/**
 * How long the process holding a pending or paging row is trusted to finish its page before
 * a retry may take the row over. One Telegram call plus one push takes seconds; the lease is
 * the long-stop for a process that died in between, not a budget the happy path spends.
 */
const ALERT_LEASE_MS = 60_000;

/**
 * The answer to a retry whose row has an unconfirmed page in another caller's hands. 503 because
 * the edge retries it (camera-bridge/visitd/cloud_client.py: any 5xx is transient) and dead-letters
 * most 4xx; never a 2xx, which the edge acknowledges for good.
 */
function pageNotYetConfirmed(rowId: string): ServiceError {
  return new ServiceError("The arrival page for this event is still in flight; retry.", 503, { existing: rowId });
}
/**
 * eventId idempotency spans the whole DeviceEvent retention (data-cleanup
 * deletes after 90 days): the edge outbox is durable and can legitimately
 * replay an event days after an outage, and a replay must never become a
 * second row or a second alert while the original still exists.
 */
const EVENT_ID_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/**
 * An event whose own timestamp is older than this is a replay (the outbox
 * flushing after a WAN outage), not a car arriving now: stored for the
 * ledger, never paged. Two hours also absorbs any Frigate/box clock skew
 * short of a broken NTP, which the heartbeat sentinel would surface anyway.
 */
const STALE_EVENT_MS = 2 * 60 * 60 * 1000;

/** Pure: 20:00-07:00 ET is quiet. Exported for the tests. */
export function isQuietHoursET(hour: number): boolean {
  return hour >= QUIET_HOURS.startHourET || hour < QUIET_HOURS.endHourET;
}

const COCKPIT_URL = "https://bdnick.info/system/camera";

type PlateShape = { status?: string; text?: string; normalizedText?: string } | undefined;

/**
 * A CONFIRMED_ARRIVAL with a readable plate asks nickstire who it is
 * (advisory, fire-and-forget). `customerRef` makes it idempotent per plate
 * text: `matched` / `unmatched` are terminal for the plate that was looked
 * up; `lookup_failed` (bridge down, handler not deployed yet) and a plate
 * that was corrected since are retried on the next confirmed update.
 */
function maybeLinkCustomer(args: {
  eventId: string;
  state: string;
  plate: PlateShape;
  existingData: Record<string, unknown>;
  telegramMessageId: string | null;
  alertText?: string;
  buttons: InlineButton[][];
}): void {
  if (args.state !== "CONFIRMED_ARRIVAL") return;
  const plateText = args.plate?.normalizedText || args.plate?.text;
  if (!plateText) return;
  if (args.plate?.status === "NONE" || args.plate?.status === "UNREADABLE") return;
  const ref = args.existingData.customerRef as { status?: string; plate?: string } | undefined;
  if (ref && ref.status !== "lookup_failed" && ref.plate === plateText) return;
  void linkVisitToCustomer({
    eventId: args.eventId,
    plate: plateText,
    telegramMessageId: args.telegramMessageId,
    alertText: args.alertText,
    buttons: args.buttons,
  }).catch(() => undefined);
}

/**
 * Handle one incoming vehicle event for an already-resolved device (cuid).
 * Returns the DeviceEvent id (existing row on update / duplicate).
 */
export async function handleVehicleEvent(deviceId: string, payload: unknown): Promise<string> {
  const parsed = VehicleEventSchema.safeParse(payload);
  if (!parsed.success) {
    log.warn("vehicle_event_invalid", { deviceId, issues: parsed.error.issues.slice(0, 5) });
    throw new ServiceError("Invalid vehicle event payload", 400, parsed.error.flatten());
  }
  const event = parsed.data;
  const eventName = event.event || "vehicle_detected";
  const data = event.data ?? {};
  const source = event.source || "local";
  const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();

  // Test panel events bypass the feature flag to allow verification tests
  const isEnabled = (getFlag("NICK_ARRIVAL_INTELLIGENCE")?.isOn ?? false) || source === "test-panel";
  if (!isEnabled) {
    log.info("arrival_intel_disabled", { deviceId });
  }

  const zone = data.zone || "unknown";
  const zoneName = data.zoneName || zone;
  const state = data.state || "DETECTED";
  const label = data.label || "vehicle";
  const confidence = data.confidence ?? 0;
  const dwellSeconds = data.dwellSeconds ?? 0;
  const trackId = data.trackId ?? null;
  const visitId = data.visitId ?? null;
  const visitKey = visitId ?? trackId;
  const cameraId = data.cameraId ?? null;
  const cameraName = data.cameraName || "Unknown Camera";
  const plate = data.plate ?? {};

  if (!(VEHICLE_STATES as readonly string[]).includes(state)) {
    log.warn("vehicle_event_unknown_state", { deviceId, state });
  }

  log.info("processing_vehicle_event", { deviceId, visitId, trackId, state, zone, hasPlate: Boolean(plate.text) });

  const formatAlertText = (currentState: string, currentDwell: number, currentPlate: typeof plate) => {
    let plateLine = "NONE";
    if (currentPlate && currentPlate.status && currentPlate.status !== "NONE") {
      const known = currentPlate.knownName ? ` ${currentPlate.knownName}` : "";
      const stateStr = currentPlate.state ? ` (${currentPlate.state})` : "";
      const textStr = currentPlate.text ? ` <b>${currentPlate.text}</b>` : "";
      plateLine = `${currentPlate.status}${textStr}${known}${stateStr} [conf: ${Math.round((currentPlate.confidence || 0) * 100)}%]`;
    }
    const urgencyIcon = currentState === "CONFIRMED_ARRIVAL" ? "🚨" : "🚗";
    const visitLine = visitKey ? `<b>Visit:</b> ${String(visitKey).slice(0, 12)}\n` : "";
    return (
      `${urgencyIcon} <b>Vehicle Arrival Intelligence</b>\n\n` +
      `<b>Camera:</b> ${cameraName}\n` +
      `<b>Zone:</b> ${zoneName}\n` +
      `<b>Type:</b> ${label} (${Math.round(confidence * 100)}%)\n` +
      `<b>State:</b> ${currentState}${data.estimated ? " (estimated)" : ""}\n` +
      `<b>Dwell:</b> ${Math.round(currentDwell)}s\n` +
      `<b>Plate:</b> ${plateLine}\n` +
      visitLine +
      `\n<i>Time: ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" })}</i>`
    );
  };

  const buttons: InlineButton[][] = [[{ text: "📹 Open Camera Panel", url: COCKPIT_URL }]];

  /**
   * Page the operator for a row that ALREADY EXISTS, then clear its pending marker. The row
   * comes first on purpose: a retry can then tell "paged" from "died before paging" by the
   * marker, where a row written after the page could not tell either from "never happened".
   */
  const pageAndRecord = async (
    rowId: string,
    currentData: Record<string, unknown>,
  ): Promise<{ telegramMessageId: string | null; text: string }> => {
    const text = formatAlertText(state, dwellSeconds, plate);
    log.info("sending_new_telegram_alert", { deviceId, cameraId, zone, state, rowId });
    const res = (await sendTelegramWithButtons(text, buttons).catch((err) => {
      log.error("failed_to_send_telegram", { error: err.message });
      return { ok: false };
    })) as { ok: boolean; messageId?: number };
    const telegramMessageId = res.ok && res.messageId ? String(res.messageId) : null;
    if (telegramMessageId) log.info("telegram_alert_sent", { messageId: telegramMessageId });

    // Web push next to Telegram. Tagged per visit so PR #1740 flood control
    // applies; a failure here never fails the ingest.
    try {
      await sendPush({
        title: state === "CONFIRMED_ARRIVAL" ? "Vehicle arrived" : "Vehicle entering lot",
        body: `${cameraName} · ${zoneName}${plate.text ? ` · ${plate.text}` : ""}`,
        level: state === "CONFIRMED_ARRIVAL" ? "high" : "medium",
        tag: `arrival:${visitKey ?? `${cameraId ?? deviceId}:${zone}`}`,
        url: COCKPIT_URL,
        data: { deviceId, visitId, trackId, state },
      });
    } catch (err) {
      log.warn("arrival_push_failed", { error: err instanceof Error ? err.message : String(err) });
    }

    const cleared = { ...currentData, telegramMessageId, alertSuppressedReason: null } as Prisma.InputJsonObject;
    const lease = typeof currentData.alertClaimedAt === "number" ? currentData.alertClaimedAt : null;
    try {
      if (lease === null) {
        // A row written before leases existed: nothing to pin, clear it as before.
        await prisma.deviceEvent.update({ where: { id: rowId }, data: { data: cleared } });
      } else {
        // Pinned on OUR lease: if a retry took the row over while this page was in flight (the
        // page outran the lease), the clear belongs to the new holder. count 0 is a fact to
        // record, never a reason to overwrite the other caller's marker.
        const r = await prisma.deviceEvent.updateMany({
          where: { id: rowId, data: { path: ["alertClaimedAt"], equals: lease } },
          data: { data: cleared },
        });
        if (r.count !== 1) {
          log.warn("alert_marker_lease_lost", { rowId, eventId: event.eventId ?? null, lease, telegramMessageId });
        }
      }
    } catch (err) {
      // The one remaining double-page window: the page went out and the marker could not be
      // cleared, so a retry of this eventId will page again. Say so where it can be found.
      log.error("alert_marker_not_cleared", { rowId, eventId: event.eventId ?? null, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    return { telegramMessageId, text };
  };

  /**
   * Take over a pending (or stale paging) row's page -- exactly one caller wins. A read that
   * found the marker is not a claim: two retries read the same row. The swap is pinned on
   * every field the decision read, the marker value and the lease deadline (a row written
   * before leases existed has no deadline, and its marker alone is the pin: the swap moves it
   * to "paging", so the second retry's swap finds no "pending" and loses). `count === 1` wins;
   * anything else means another caller holds the page, and this one does nothing.
   */
  const claimPendingPage = async (
    rowId: string,
    currentData: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> => {
    const now = Date.now();
    const marker = currentData.alertSuppressedReason;
    const lease = typeof currentData.alertClaimedAt === "number" ? currentData.alertClaimedAt : null;
    if (lease !== null && now - lease < ALERT_LEASE_MS) return null; // the holder is still paging
    const next = { ...currentData, alertSuppressedReason: ALERT_PAGING, alertClaimedAt: now };
    const r = await prisma.deviceEvent.updateMany({
      where: {
        id: rowId,
        AND: [
          { data: { path: ["alertSuppressedReason"], equals: marker as string } },
          ...(lease !== null ? [{ data: { path: ["alertClaimedAt"], equals: lease } }] : []),
        ],
      },
      data: { data: next as Prisma.InputJsonObject },
    });
    return r.count === 1 ? next : null;
  };

  // 0. Idempotency: a repeated eventId is a retry from the edge outbox.
  if (event.eventId) {
    const duplicate = await prisma.deviceEvent.findFirst({
      where: {
        deviceId,
        event: eventName,
        createdAt: { gte: new Date(Date.now() - EVENT_ID_WINDOW_MS) },
        data: { path: ["eventId"], equals: event.eventId },
      },
      orderBy: { createdAt: "desc" },
    });
    if (duplicate) {
      const dupData = (duplicate.data as Record<string, unknown> | null) || {};
      if (dupData.alertSuppressedReason === ALERT_PENDING || dupData.alertSuppressedReason === ALERT_PAGING) {
        // The row landed and the page after it has not completed. Either its holder is still
        // paging (lease fresh: leave it), or the process died in between (lease lapsed, or a row
        // from before leases): claim the page with a compare-and-swap and finish it, once.
        const claimed = await claimPendingPage(duplicate.id, dupData);
        if (!claimed) {
          // Another caller holds the page: its lease is fresh, or it just won the swap. Until that
          // page is confirmed this retry must stay retryable, or a holder that died takes the
          // page with it.
          log.info("duplicate_event_page_in_progress", { deviceId, eventId: event.eventId, existing: duplicate.id });
          throw pageNotYetConfirmed(duplicate.id);
        }
        log.info("duplicate_event_completing_alert", { deviceId, eventId: event.eventId, existing: duplicate.id });
        await pageAndRecord(duplicate.id, claimed);
        return duplicate.id;
      }
      log.info("duplicate_event_ignored", { deviceId, eventId: event.eventId, existing: duplicate.id });
      return duplicate.id;
    }
  }

  // 1. Existing row for this visit (v2) or track (v1)?
  let existingEvent = null;
  if (visitId) {
    existingEvent = await prisma.deviceEvent.findFirst({
      where: {
        deviceId,
        event: eventName,
        createdAt: { gte: new Date(Date.now() - VISIT_WINDOW_MS) },
        data: { path: ["visitId"], equals: visitId },
      },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!existingEvent && trackId) {
    existingEvent = await prisma.deviceEvent.findFirst({
      where: {
        deviceId,
        event: eventName,
        createdAt: { gte: new Date(Date.now() - TRACK_WINDOW_MS) },
        data: { path: ["trackId"], equals: trackId },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (existingEvent) {
    log.info("updating_existing_event", { eventId: existingEvent.id, state });

    const existingData = (existingEvent.data as Record<string, unknown> | null) || {};
    const updatedData = {
      ...existingData,
      ...data,
      eventId: event.eventId ?? existingData.eventId ?? null,
      // preserve telegramMessageId
      telegramMessageId: existingData.telegramMessageId,
    };

    await prisma.deviceEvent.update({
      where: { id: existingEvent.id },
      data: { data: updatedData as Prisma.InputJsonObject, timestamp },
    });

    const telegramMessageId = existingData.telegramMessageId;
    // Every refresh re-composes the persisted customer line; the link path
    // appends only when it writes a NEW answer (it gets the base text).
    const baseText = formatAlertText(state, dwellSeconds, plate);
    const updatedText = baseText + renderCustomerLine(existingData.customerRef);
    if (telegramMessageId && isEnabled) {
      log.info("editing_telegram_alert", { telegramMessageId, state });
      await editTelegramMessage(Number(telegramMessageId), updatedText, undefined, buttons).catch((err) => {
        log.error("failed_to_edit_telegram", { error: err.message });
      });
    }

    maybeLinkCustomer({
      eventId: existingEvent.id,
      state,
      plate,
      existingData,
      telegramMessageId: telegramMessageId ? String(telegramMessageId) : null,
      alertText: isEnabled ? baseText : undefined,
      buttons,
    });

    return existingEvent.id;
  }

  // 2. Cooldown per camera + zone (a second camera must not be crushed by
  //    the first one's window).
  const cooldownLimit = new Date(Date.now() - COOLDOWN_SECONDS * 1000);
  const recentAlert = await prisma.deviceEvent.findFirst({
    where: {
      deviceId,
      event: eventName,
      createdAt: { gte: cooldownLimit },
      AND: [
        { data: { path: ["zone"], equals: zone } },
        ...(cameraId ? [{ data: { path: ["cameraId"], equals: cameraId } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  const isCooldownActive =
    !!recentAlert && (!recentAlert.data || !!(recentAlert.data as Record<string, unknown>).telegramMessageId);

  // 3. Quiet hours: arrivals do not page at night. The suppression is recorded.
  const quiet = isQuietHoursET(hourET());
  // 3b. A replayed event (the edge outbox flushing after an outage) is a
  //     ledger fact about the past, never a page now.
  const ageMs = Date.now() - timestamp.getTime();
  const staleReplay = ageMs > STALE_EVENT_MS;

  const wantsAlert = ALERT_STATES.has(state);
  let alertSuppressedReason: string | null = null;
  if (!isEnabled) alertSuppressedReason = "flag_off";
  else if (!wantsAlert) alertSuppressedReason = "state";
  else if (staleReplay) alertSuppressedReason = "stale_replay";
  else if (isCooldownActive) alertSuppressedReason = "cooldown";
  else if (quiet) alertSuppressedReason = "quiet_hours";

  // 4. THE ROW FIRST, then the page. Written with the pending marker when a page is due, so
  //    a retry can tell a completed page from a process that died between the two.
  const eventData = {
    ...data,
    eventId: event.eventId ?? null,
    schemaVersion: event.schemaVersion ?? 1,
    telegramMessageId: null,
    alertSuppressedReason: alertSuppressedReason ?? ALERT_PENDING,
    // The writer's lease on the page it is about to send: a retry inside ALERT_LEASE_MS leaves
    // the row alone; one past it may claim the page (claimPendingPage).
    ...(alertSuppressedReason === null ? { alertClaimedAt: Date.now() } : {}),
  };

  let newEvent: { id: string };
  try {
    newEvent = await prisma.deviceEvent.create({
      data: { deviceId, event: eventName, data: eventData as Prisma.InputJsonObject, source, timestamp },
    });
  } catch (err) {
    // The unique index on (device_id, data->>'eventId') refused a second row for this
    // eventId: a retry that passed the pre-check at the same moment as its twin. The twin
    // owns the page; answer with its row.
    if ((err as { code?: string }).code === "P2002" && event.eventId) {
      const winner = await prisma.deviceEvent.findFirst({
        where: { deviceId, event: eventName, data: { path: ["eventId"], equals: event.eventId } },
        orderBy: { createdAt: "desc" },
      });
      if (winner) {
        // The twin is still paging (its row carries the marker): the same unconfirmed page as
        // a retry inside a lease, and the same retryable answer.
        const winnerMarker = (winner.data as Record<string, unknown> | null)?.alertSuppressedReason;
        if (winnerMarker === ALERT_PENDING || winnerMarker === ALERT_PAGING) {
          log.info("duplicate_event_lost_race_page_in_flight", { deviceId, eventId: event.eventId, existing: winner.id });
          throw pageNotYetConfirmed(winner.id);
        }
        log.info("duplicate_event_lost_race", { deviceId, eventId: event.eventId, existing: winner.id });
        return winner.id;
      }
    }
    throw err;
  }

  let telegramMessageId: string | null = null;
  let sentAlertText: string | undefined;
  if (alertSuppressedReason === null) {
    const paged = await pageAndRecord(newEvent.id, eventData);
    telegramMessageId = paged.telegramMessageId;
    sentAlertText = paged.text;
  } else {
    log.info("telegram_alert_skipped", { reason: alertSuppressedReason, state, isEnabled, isCooldownActive, quiet, ageMs });
  }

  maybeLinkCustomer({
    eventId: newEvent.id,
    state,
    plate,
    existingData: {},
    telegramMessageId,
    alertText: sentAlertText,
    buttons,
  });

  return newEvent.id;
}
