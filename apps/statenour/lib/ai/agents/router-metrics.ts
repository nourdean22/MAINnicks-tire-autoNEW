import { prisma } from "@/lib/prisma";

/**
 * Record a specialist-routing classification. 2026-07-12 · `shadow` is now
 * a real parameter (was hardcoded true): the caller records this in BOTH
 * shadow and live mode so routing telemetry survives the ENABLE_SPECIALIST_
 * ROUTING shadow→true flip — previously it was written only in the shadow
 * branch, so the operator lost all routing visibility the moment routing
 * went live. `dispatched` marks a turn a specialist actually handled.
 */
export async function recordSpecialistRouteMetric(
  route: string,
  confidence: number,
  reason: string,
  opts: { shadow?: boolean; dispatched?: boolean } = {},
): Promise<void> {
  try {
    await prisma.systemMetric.create({
      data: {
        metric: "specialist.route",
        value: confidence,
        unit: "confidence",
        source: "chat",
        tags: {
          route,
          reason: reason.slice(0, 120),
          shadow: opts.shadow ?? true,
          dispatched: opts.dispatched ?? false,
        } as any,
      },
    });
  } catch (err) {
    // Fire-and-forget: ignore DB errors in metrics logging
  }
}

/**
 * 2026-07-12 · Alert the operator the FIRST time a given specialist actually
 * handles a live chat turn. The shadow→live flip is prod-first (no specialist
 * had ever dispatched), so this makes that moment not-unwatched. Deduped once
 * per route via a durable BrainMemory flag; fire-and-forget so it can never
 * delay or fail the chat turn.
 */
export async function alertFirstSpecialistDispatch(route: string, reason: string): Promise<void> {
  try {
    const key = `specialist_first_dispatch:${route}`;
    const existing = await prisma.brainMemory.findFirst({
      where: { category: "system_flag", key, deletedAt: null },
      select: { id: true },
    });
    if (existing) return; // already alerted once for this route
    await prisma.brainMemory.create({
      data: {
        category: "system_flag",
        key,
        content: `First live specialist dispatch: ${route}`,
        confidence: 1,
        source: "specialist-router",
      },
    });
    const { sendTelegramOpsAlert } = await import("@/lib/ai/telegram-ops");
    await sendTelegramOpsAlert(
      `🎯 First LIVE specialist dispatch — ${route} just handled a chat turn in prod.\n` +
        `Reason: ${reason.slice(0, 140)}\n` +
        `Specialist routing is now active (ENABLE_SPECIALIST_ROUTING=true). Glance at the reply to sanity-check it.`,
    );
  } catch {
    // Fire-and-forget: an alert failure must never affect the chat turn.
  }
}
