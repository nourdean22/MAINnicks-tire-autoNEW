import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { today } from "@/lib/utils/datetime";
import { processShopEvent, type ShopEvent } from "@/lib/brain/pipeline-controller";
import { emitDriftFired } from "@/lib/db/brain-bus-emit";
import { recordCoachEvent } from "@/lib/services/coach-events";

/**
 * POST /api/sync/events
 * Receives business events from nickstire.org bridge.
 * Auth: Bearer STATENOUR_SYNC_KEY
 */
export const POST = apiHandler(
  async (req) => {
    const body = await req.json();
    const events: Array<{
      type: string;
      timestamp: string;
      source: string;
      data: Record<string, unknown>;
    }> = body.events ?? [body];

    const results = [];

    for (const event of events) {
      try {
        // Store every event as an audit record
        await prisma.auditEvent.create({
          data: {
            actor: event.source ?? "nickstire",
            eventType: event.type,
            detail: `Bridge event: ${event.type}`,
            payload: JSON.parse(JSON.stringify(event.data ?? event)),
          },
        });
      } catch (auditErr) {
        console.warn("[sync/events] Audit write failed:", auditErr);
        // Don't fail the whole request for an audit write failure
      }

      try {
        // Create drift alert for negative reviews
        if (event.type === "nickstire:review" && (event.data?.rating as number) <= 3) {
          const today_ = today();
          const message = `${event.data?.rating}★ review from ${event.data?.author ?? "customer"}: ${String(event.data?.text ?? "").substring(0, 120)}`;
          const coachEvent = await recordCoachEvent({
            kind: "drift-recovery",
            subjectId: "negative_review",
            priority: "P0",
            title: "Negative Google Review",
            body: message,
            surfaces: ["tasks", "goals", "journal", "brain", "scoreboard", "home"],
          });
          if (coachEvent) {
            // v10.0.63 · brain-bus producer
            void emitDriftFired({
              alertId: coachEvent.eventId,
              ruleId: "negative_review",
              ruleName: "Negative Google Review",
              severity: "critical",
              message,
              date: today_,
            });
          }
        }

        // Create drift alert for callback overdue
        if (event.type === "nickstire:callback") {
          const today_ = today();
          const message = `Callback: ${event.data?.name ?? "Unknown"} — ${event.data?.phone ?? "no phone"}`;
          const coachEvent = await recordCoachEvent({
            kind: "drift-recovery",
            subjectId: "callback_requested",
            priority: "P2",
            title: "Customer Callback Requested",
            body: message,
            surfaces: ["tasks", "goals", "journal", "brain", "scoreboard", "home"],
          });
          if (coachEvent) {
            // v10.0.63 · brain-bus producer
            void emitDriftFired({
              alertId: coachEvent.eventId,
              ruleId: "callback_requested",
              ruleName: "Customer Callback Requested",
              severity: "warning",
              message,
              date: today_,
            });
          }
        }

        // Sync social draft from Nick's Tire
        if (event.type === "nickstire:social_draft:sync") {
          const d = event.data;
          if (d && d.id) {
            await prisma.socialPublishQueue.upsert({
              where: { id: String(d.id) },
              create: {
                id: String(d.id),
                content: String(d.content || ""),
                status: String(d.status || "pending"),
                imageUrl: d.imageUrl ? String(d.imageUrl) : null,
                platforms: Array.isArray(d.platforms) ? d.platforms.map(String) : [],
                kind: String(d.kind || "post"),
                source: String(d.source || "nick"),
                sourceMetadata: (d.sourceMetadata as any) || {},
                missionId: d.missionId ? String(d.missionId) : null,
                scheduledFor: d.scheduledFor ? new Date(d.scheduledFor as string | number | Date) : null,
                publishedAt: d.publishedAt ? new Date(d.publishedAt as string | number | Date) : null,
                publishUrls: Array.isArray(d.publishUrls) ? d.publishUrls.map(String) : [],
              },
              update: {
                content: String(d.content || ""),
                status: String(d.status || "pending"),
                imageUrl: d.imageUrl ? String(d.imageUrl) : null,
                platforms: Array.isArray(d.platforms) ? d.platforms.map(String) : [],
                kind: String(d.kind || "post"),
                source: String(d.source || "nick"),
                sourceMetadata: (d.sourceMetadata as any) || {},
                missionId: d.missionId ? String(d.missionId) : null,
                scheduledFor: d.scheduledFor ? new Date(d.scheduledFor as string | number | Date) : null,
                publishedAt: d.publishedAt ? new Date(d.publishedAt as string | number | Date) : null,
                publishUrls: Array.isArray(d.publishUrls) ? d.publishUrls.map(String) : [],
              },
            });
          }
        }
      } catch (alertErr) {
        console.warn("[sync/events] Alert write failed:", alertErr);
      }

      results.push({ type: event.type, stored: true });

      // Fire brain pipeline — FIRE AND FORGET (don't block the response)
      const typeMap: Record<string, ShopEvent["type"]> = {
        "nickstire:booking": "booking",
        "nickstire:booking:complete": "booking",
        "nickstire:lead": "lead",
        "nickstire:review": "review",
        "nickstire:invoice": "invoice",
        "nickstire:stage-change": "stage-change",
        "nickstire:campaign-result": "campaign",
        "nickstire:emergency": "emergency",
        "nickstire:tire_order": "invoice",
        "nickstire:callback": "lead",
        "nickstire:revenue": "invoice",
      };
      const shopType = typeMap[event.type];
      if (shopType) {
        // Don't await — let pipeline run in background after response
        processShopEvent({
          type: shopType,
          data: (event.data ?? {}) as Record<string, unknown>,
          timestamp: event.timestamp,
        }).catch((err) => console.error("[sync/events] Pipeline error:", err));
      }
    }

    return { ok: true, received: results.length, results };
  },
  { auth: "sync" }
);

// GET: Return recent bridge events
export const GET = apiHandler(
  async () => {
    const events = await prisma.auditEvent.findMany({
      where: {
        eventType: { startsWith: "nickstire:" },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return {
      count: events.length,
      events: events.map((e) => ({
        type: e.eventType,
        payload: e.payload,
        at: e.createdAt,
      })),
    };
  },
  { auth: "sync" }
);
