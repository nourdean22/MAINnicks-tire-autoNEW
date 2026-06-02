/**
 * Camera-system + Telegram-push action handlers.
 *
 * Extracted VERBATIM from lib/ai/nick-agent.ts executeAction (2026-06-02
 * structural split). telegram.send lives here as the remaining
 * standalone push action.
 */
import { prisma } from "@/lib/prisma";
import type { ActionParams, ActionResult } from "./types";

export async function handleTelegramSend(params: ActionParams, type: string): Promise<ActionResult> {
  const { sendTelegram, formatTelegramNotification } = await import("@/lib/services/telegram");
  const urgency = String(params.urgency || "medium");
  const prefix = urgency === "high" ? "🚨" : urgency === "medium" ? "📌" : "💬";
  const msg = params.title
    ? formatTelegramNotification(String(params.title), `${prefix} ${String(params.message || "")}`)
    : `${prefix} ${String(params.message || "")}`;
  const sent = await sendTelegram(msg);
  return { action: type, success: sent, result: { sent, urgency } };
}

export async function handleCameraGetIntelligence(_params: ActionParams, type: string): Promise<ActionResult> {
  const { getCameraIntelligence } = await import("@/lib/brain/camera-intelligence");
  const intel = await getCameraIntelligence();
  return { action: type, success: true, result: intel };
}

export async function handleCameraResolveAlert(params: ActionParams, type: string): Promise<ActionResult> {
  // v10.0.59 · Wave A part 2 · Camera alerts now persisted as
  // BrainMemory category="camera_alert" by v10.0.55 camera-
  // intelligence rewrite. Resolve = soft-delete the row.
  const alertKey = String(params.alertKey || "").trim();
  if (!alertKey) {
    return { action: type, success: false, error: "alertKey required" };
  }
  await prisma.brainMemory
    .updateMany({
      where: {
        category: "camera_alert",
        key: alertKey,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    })
    .catch(() => undefined);
  return { action: type, success: true, result: { resolved: true, alertKey } };
}

export async function handleCameraGetAlerts(_params: ActionParams, type: string): Promise<ActionResult> {
  // v10.0.59 · sourced from BrainMemory category="camera_alert".
  const alertRows = await prisma.brainMemory
    .findMany({
      where: { category: "camera_alert", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { key: true, content: true, createdAt: true },
    })
    .catch((): Array<{ key: string; content: string; createdAt: Date }> => []);
  return {
    action: type,
    success: true,
    result: { count: alertRows.length, alerts: alertRows },
  };
}

export async function handleCameraGetPlates(_params: ActionParams, type: string): Promise<ActionResult> {
  // v10.0.59 · ALPR (license-plate recognition) not yet wired
  // into the deviceEvent pipeline. Returns empty + redirect
  // message; future v11+ work will add a `vehicle_detected`
  // event subtype with a `plate` field in the payload.
  return {
    action: type,
    success: true,
    result: {
      count: 0,
      plates: [],
      note: "ALPR pipeline not yet wired — vehicle_detected events lack plate metadata.",
    },
  };
}
