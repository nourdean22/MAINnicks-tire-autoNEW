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
const VISIT_WINDOW_MS = 12 * 60 * 60 * 1000;
const TRACK_WINDOW_MS = 10 * 60 * 1000;
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

  let telegramMessageId: number | null = null;
  let alertSuppressedReason: string | null = null;
  let sentAlertText: string | undefined;
  const wantsAlert = ALERT_STATES.has(state);

  if (!isEnabled) alertSuppressedReason = "flag_off";
  else if (!wantsAlert) alertSuppressedReason = "state";
  else if (staleReplay) alertSuppressedReason = "stale_replay";
  else if (isCooldownActive) alertSuppressedReason = "cooldown";
  else if (quiet) alertSuppressedReason = "quiet_hours";

  if (alertSuppressedReason === null) {
    const text = formatAlertText(state, dwellSeconds, plate);
    sentAlertText = text;
    log.info("sending_new_telegram_alert", { deviceId, cameraId, zone, state });
    const res = (await sendTelegramWithButtons(text, buttons).catch((err) => {
      log.error("failed_to_send_telegram", { error: err.message });
      return { ok: false };
    })) as { ok: boolean; messageId?: number };

    if (res.ok && res.messageId) {
      telegramMessageId = res.messageId;
      log.info("telegram_alert_sent", { messageId: telegramMessageId });
    }

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
  } else {
    log.info("telegram_alert_skipped", { reason: alertSuppressedReason, state, isEnabled, isCooldownActive, quiet, ageMs });
  }

  const eventData = {
    ...data,
    eventId: event.eventId ?? null,
    schemaVersion: event.schemaVersion ?? 1,
    telegramMessageId: telegramMessageId ? String(telegramMessageId) : null,
    alertSuppressedReason,
  };

  const newEvent = await prisma.deviceEvent.create({
    data: { deviceId, event: eventName, data: eventData as Prisma.InputJsonObject, source, timestamp },
  });

  maybeLinkCustomer({
    eventId: newEvent.id,
    state,
    plate,
    existingData: {},
    telegramMessageId: telegramMessageId ? String(telegramMessageId) : null,
    alertText: sentAlertText,
    buttons,
  });

  return newEvent.id;
}
