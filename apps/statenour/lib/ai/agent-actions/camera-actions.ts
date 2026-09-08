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

export async function handleCameraGetPlates(params: ActionParams, type: string): Promise<ActionResult> {
  // 2026-09-08 · ADR-0017 / master-plan C6. This used to return
  // `count: 0` unconditionally with a note that ALPR "is not wired" —
  // while `vehicle_detected` events have carried `data.plate` since
  // PR #315 and the cockpit has a plate-correction UI. A chat tool that
  // asserts zero regardless of the DB is a lie to the operator.
  //
  // Reads the last `days` (1-30, default 7) of vehicle_detected events and
  // returns every plate read. A failed read is reported as a failure, never
  // as an empty list (empty-vs-error).
  const days = Math.min(30, Math.max(1, Number(params.days ?? 7) || 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // Newest-first scan cap. Hitting it means older plate reads inside the
  // window were NOT seen, and the result says so instead of posing as the
  // whole period.
  const PLATE_SCAN_LIMIT = 500;
  let rows: Array<{ id: string; deviceId: string; timestamp: Date; data: unknown }> | null = null;
  try {
    rows = await prisma.deviceEvent.findMany({
      where: { event: "vehicle_detected", timestamp: { gte: since } },
      orderBy: { timestamp: "desc" },
      take: PLATE_SCAN_LIMIT,
      select: { id: true, deviceId: true, timestamp: true, data: true },
    });
  } catch (err) {
    return {
      action: type,
      success: false,
      error: `plate read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const plates = rows.flatMap((r) => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const p = d.plate as Record<string, unknown> | undefined;
    if (!p || typeof p.text !== "string" || !p.text) return [];
    return [
      {
        eventId: r.id,
        deviceId: r.deviceId,
        at: r.timestamp.toISOString(),
        text: p.text,
        normalizedText: typeof p.normalizedText === "string" ? p.normalizedText : null,
        status: typeof p.status === "string" ? p.status : "CANDIDATE",
        confidence: typeof p.confidence === "number" ? p.confidence : null,
        state: typeof d.state === "string" ? d.state : null,
        visitId: (d.visitId as string | undefined) ?? (d.trackId as string | undefined) ?? null,
      },
    ];
  });
  return {
    action: type,
    success: true,
    result: {
      days,
      eventsScanned: rows.length,
      partial: rows.length >= PLATE_SCAN_LIMIT,
      count: plates.length,
      plates: plates.slice(0, 100),
      note:
        rows.length === 0
          ? `no vehicle_detected events in the last ${days} day(s)`
          : rows.length >= PLATE_SCAN_LIMIT
            ? `PARTIAL: only the newest ${PLATE_SCAN_LIMIT} events in the window were scanned; older plate reads are not included - narrow days`
            : undefined,
    },
  };
}
