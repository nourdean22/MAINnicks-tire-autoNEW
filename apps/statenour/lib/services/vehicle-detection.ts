import { prisma } from "@/lib/prisma";
import { getFlag } from "@/lib/feature-flags";
import { sendTelegramWithButtons, editTelegramMessage, InlineButton } from "@/lib/services/telegram";
import { logger } from "@/lib/logger";

const log = logger.withSurface("services/vehicle-detection");

/**
 * Handle incoming vehicle detection events.
 * Performs database log creation, deduplication, cooldown check, and alerts.
 */
export async function handleVehicleEvent(deviceId: string, payload: any): Promise<string> {
  const isEnabled = getFlag("NICK_ARRIVAL_INTELLIGENCE")?.isOn ?? false;
  if (!isEnabled) {
    log.info("arrival_intel_disabled", { deviceId });
  }

  const eventName = payload.event || "vehicle_detected";
  const data = payload.data || {};
  const source = payload.source || "local";
  const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();

  // Extract fields
  const zone = data.zone || "unknown";
  const zoneName = data.zoneName || zone;
  const state = data.state || "DETECTED";
  const label = data.label || "vehicle";
  const confidence = data.confidence || 0;
  const dwellSeconds = data.dwellSeconds || 0;
  const trackId = data.trackId || null;
  const cameraName = data.cameraName || "Unknown Camera";
  
  const plate = data.plate || {};
  const plateText = plate.text || "";
  const plateStatus = plate.status || "NONE";
  const plateConfidence = plate.confidence || 0;
  const plateState = plate.state || "";

  log.info("processing_vehicle_event", { deviceId, trackId, state, zone, plateText });

  // 1. Check if we have an existing event for this track in the last 10 minutes
  let existingEvent = null;
  if (trackId) {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    existingEvent = await prisma.deviceEvent.findFirst({
      where: {
        deviceId,
        event: "vehicle_detected",
        createdAt: { gte: tenMinutesAgo },
        data: {
          path: ["trackId"],
          equals: trackId,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  // Generate clean Telegram HTML copy
  const formatAlertText = (currentState: string, currentDwell: number, currentPlate: any) => {
    let plateLine = "NONE";
    if (currentPlate && currentPlate.status && currentPlate.status !== "NONE") {
      const stateStr = currentPlate.state ? ` (${currentPlate.state})` : "";
      const textStr = currentPlate.text ? ` <b>${currentPlate.text}</b>` : "";
      plateLine = `${currentPlate.status}${textStr}${stateStr} [conf: ${Math.round((currentPlate.confidence || 0) * 100)}%]`;
    }

    const urgencyIcon = currentState === "CONFIRMED_ARRIVAL" ? "🚨" : "🚗";
    return `${urgencyIcon} <b>Vehicle Arrival Intelligence</b>\n\n` +
      `<b>Camera:</b> ${cameraName}\n` +
      `<b>Zone:</b> ${zoneName}\n` +
      `<b>Type:</b> ${label} (${Math.round(confidence * 100)}%)\n` +
      `<b>State:</b> ${currentState}\n` +
      `<b>Dwell:</b> ${currentDwell}s\n` +
      `<b>Plate:</b> ${plateLine}\n\n` +
      `<i>Time: ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" })}</i>`;
  };

  const buttons: InlineButton[][] = [
    [
      {
        text: "📹 Open Camera Panel",
        url: "https://bdnick.info/system/camera",
      },
    ],
  ];

  if (existingEvent) {
    log.info("updating_existing_event", { eventId: existingEvent.id });
    
    // Merge data
    const existingData = (existingEvent.data as any) || {};
    const updatedData = {
      ...existingData,
      ...data,
      // preserve telegramMessageId
      telegramMessageId: existingData.telegramMessageId,
    };

    // Update event in DB
    await prisma.deviceEvent.update({
      where: { id: existingEvent.id },
      data: {
        data: updatedData,
        timestamp,
      },
    });

    // Check if we have an active Telegram message to update
    const telegramMessageId = existingData.telegramMessageId;
    if (telegramMessageId && isEnabled) {
      // Edit the existing Telegram message with updated info
      const text = formatAlertText(state, dwellSeconds, plate);
      log.info("editing_telegram_alert", { telegramMessageId, state });
      await editTelegramMessage(Number(telegramMessageId), text, undefined, buttons).catch((err) => {
        log.error("failed_to_edit_telegram", { error: err.message });
      });
    }
    
    return existingEvent.id;
  }

  // 2. Check for cooldown/debounce if we are creating a new event alert
  const cooldownSeconds = 120;
  const cooldownLimit = new Date(Date.now() - cooldownSeconds * 1000);
  
  const recentAlert = await prisma.deviceEvent.findFirst({
    where: {
      deviceId,
      event: "vehicle_detected",
      createdAt: { gte: cooldownLimit },
      data: {
        path: ["zone"],
        equals: zone,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const isCooldownActive = !!recentAlert && (!recentAlert.data || (recentAlert.data as any).telegramMessageId);

  let telegramMessageId: number | null = null;

  // Only send Telegram alert if we are not in cooldown, and state is CONFIRMED_ARRIVAL or ENTERED_ZONE
  const shouldAlert = isEnabled && !isCooldownActive && (state === "CONFIRMED_ARRIVAL" || state === "ENTERED_ZONE");

  if (shouldAlert) {
    const text = formatAlertText(state, dwellSeconds, plate);
    log.info("sending_new_telegram_alert", { deviceId, zone, state });
    const res: any = await sendTelegramWithButtons(text, buttons).catch((err) => {
      log.error("failed_to_send_telegram", { error: err.message });
      return { ok: false };
    });
    
    if (res.ok && res.messageId) {
      telegramMessageId = res.messageId;
      log.info("telegram_alert_sent", { messageId: telegramMessageId });
    }
  } else {
    log.info("telegram_alert_skipped", { isCooldownActive, state, isEnabled });
  }

  // Save/Create event in DB
  const eventData = {
    ...data,
    telegramMessageId: telegramMessageId ? String(telegramMessageId) : null,
  };

  const newEvent = await prisma.deviceEvent.create({
    data: {
      deviceId,
      event: eventName,
      data: eventData,
      source,
      timestamp,
    },
  });

  return newEvent.id;
}
