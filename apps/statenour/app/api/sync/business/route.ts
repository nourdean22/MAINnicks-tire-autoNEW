/**
 * /api/sync/business — Business metrics ingest from nickstire.
 *
 * Restored 2026-04-22 after deep deploy audit surfaced repeated 404s
 * on POST /api/sync/business. The route was retired in commit 82e8738
 * (dead-route sweep) but the READ side of it lives on — 8+ places in
 * the codebase query AuditEvent for `eventType: "business_metrics_sync"`
 * as part of Nick's CEO / business context (lib/ai/system-prompt.ts,
 * lib/brain/*, lib/ai/page-data.ts, app/api/command/data, etc).
 *
 * Without the writer, every "what are the current numbers?" Nick
 * prompt was getting an empty business-metrics block — silent
 * degradation of the whole personal↔business loop.
 *
 * ─── Contract ───────────────────────────────────────────────────
 * POST { ...metrics }  auth: sync (X-Sync-Key header)
 *   Stores the full payload as AuditEvent(eventType="business_metrics
 *   _sync"). If the body has `source === "nickstire"`, also emits a
 *   normalized ceo_business_context row via the existing helper.
 *   Responds with the live driftAlerts + brain-insights the sender
 *   can surface on the nickstire side.
 *
 * GET                  auth: sync
 *   Returns the latest business_metrics_sync payload + its
 *   syncedAt timestamp. Used by Nick's page-data / system-prompt
 *   path, not by external consumers directly.
 *
 * Scope: statenour STAYS personal OS. This route is the minimal
 * cross-ring bridge — it doesn't own business truth, it mirrors it
 * into the audit log so personal-OS context can reflect it.
 */

import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { buildCeoContextFromNickSyncPayload } from "@/lib/nickstire/ceo-context";

export const POST = apiHandler(
  async (req) => {
    const data = (await req.json()) as unknown;

    // Primary write — always store the raw payload so future Nick
    // prompts can reconstruct whatever context they need from it.
    await prisma.auditEvent.create({
      data: {
        actor: "nickstire-sync",
        eventType: "business_metrics_sync",
        detail: "Business metrics sync from Nick's Tire",
        payload: (data ?? {}) as object,
      },
    });

    // Normalized CEO-context derivative — only when the payload
    // self-identifies as the nickstire v2 schema.
    if (
      data &&
      typeof data === "object" &&
      (data as { source?: string }).source === "nickstire"
    ) {
      const ceoContext = buildCeoContextFromNickSyncPayload(
        data as Record<string, unknown>,
      );
      await prisma.auditEvent.create({
        data: {
          actor: "nickstire-sync",
          eventType: "ceo_business_context",
          detail: "Normalized CEO context (nickstire sync v2)",
          payload: ceoContext as object,
        },
      });
    }

    // Return live intelligence so the caller can surface it on the
    // nickstire side without a second round trip.
    const [recentAlerts, recentInsights] = await Promise.all([
      (async () => {
        const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
        return getUnresolvedAlerts().catch(() => []);
      })(),
      prisma.auditEvent.findMany({
        where: {
          eventType: {
            in: ["brain_insight", "prediction_created", "reflection_generated"],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 3,
      }),
    ]);

    return {
      ok: true,
      message: "Business metrics synced",
      insights: recentInsights.map((i) => {
        const payload = (i.payload ?? {}) as Record<string, unknown>;
        return {
          title: typeof payload.title === "string" ? payload.title : i.detail,
          type: i.eventType,
          createdAt: i.createdAt,
        };
      }),
      driftAlerts: recentAlerts.map((a) => ({
        message: a.message,
        severity: a.severity,
        urgent: a.severity === "critical",
        createdAt: a.createdAt,
      })),
      activeAlertCount: recentAlerts.length,
    };
  },
  { auth: "sync" },
);

export const GET = apiHandler(
  async () => {
    const latest = await prisma.auditEvent.findFirst({
      where: { eventType: "business_metrics_sync" },
      orderBy: { createdAt: "desc" },
    });

    if (!latest) {
      return { metrics: null, message: "No business data synced yet" };
    }

    return {
      metrics: latest.payload,
      synced_at: latest.createdAt,
    };
  },
  { auth: "sync" },
);
