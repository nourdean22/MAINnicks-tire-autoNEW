import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { today } from "@/lib/utils/datetime";
import { processShopEvent, type ShopEvent } from "@/lib/brain/pipeline-controller";
import { emitDriftFired } from "@/lib/db/brain-bus-emit";
import { recordCoachEvent } from "@/lib/services/coach-events";
import {
  claimReceipt,
  isReceiptTableMissing,
  parseIdempotencyKey,
  readIdempotencyKey,
  settleReceipt,
} from "@/lib/services/bridge-receipts";
import { ServiceError } from "@/lib/utils/service-error";

type BridgeEvent = {
  type: string;
  timestamp: string;
  source: string;
  data: Record<string, unknown>;
  idempotencyKey?: unknown;
};

/** `bridge_receipts.route` for this receiver (ADR-0019 §5.1 names it `sync/events`). */
const RECEIPT_ROUTE = "sync/events";

/**
 * ADR-0019 §4 latest-wins types. Their key names the object, not a fact, and
 * the write is already idempotent (the draft upsert on `data.id`), so a receipt
 * would wrongly swallow the NEWER state as a duplicate of the older one.
 */
const LATEST_WINS_TYPES = new Set(["nickstire:social_draft:sync", "nickstire:mirror_synced", "nickstire:data_refreshed"]);

function auditData(event: BridgeEvent) {
  return {
    actor: event.source ?? "nickstire",
    eventType: event.type,
    detail: `Bridge event: ${event.type}`,
    payload: JSON.parse(JSON.stringify(event.data ?? event)),
  };
}

/**
 * Each event's key, validated for the whole batch BEFORE anything is written,
 * so a malformed key is a clean 400 rather than a half-written batch.
 * A key rides on the event (`idempotencyKey`); the `Idempotency-Key` header
 * names a single-event request only, because one header cannot name a batch.
 */
function eventKeys(events: BridgeEvent[], headers: Headers): Array<string | null> {
  const headerKey = readIdempotencyKey(headers);
  if (headerKey && events.length !== 1) {
    throw new ServiceError("The Idempotency-Key header names one event; a batch carries idempotencyKey on each event", 400);
  }
  return events.map((event) => {
    const bodyKey = parseIdempotencyKey(event.idempotencyKey);
    if (bodyKey && headerKey && bodyKey !== headerKey) {
      throw new ServiceError("The Idempotency-Key header and the event's idempotencyKey disagree", 400);
    }
    const key = bodyKey ?? headerKey;
    return key && !LATEST_WINS_TYPES.has(event.type) ? key : null;
  });
}

type KeyedWrite = { duplicate: true; resultRef: string | null } | { duplicate: false; dedupe?: "unavailable" };

/**
 * ADR-0019 §6.2: the receipt and the AuditEvent commit together, so a crash
 * between them rolls both back and the next delivery is correctly "first".
 * A failure here is a 503, never the legacy "log and carry on": the receipt
 * rolled back, so the sender's retry lands the event exactly once.
 */
async function writeAuditOnce(event: BridgeEvent, key: string): Promise<KeyedWrite> {
  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await claimReceipt(tx, key, RECEIPT_ROUTE);
      if (!claim.first) return { duplicate: true as const, resultRef: claim.resultRef };
      const row = await tx.auditEvent.create({ data: auditData(event), select: { id: true } });
      await settleReceipt(tx, key, row.id);
      return { duplicate: false as const };
    });
  } catch (err) {
    if (isReceiptTableMissing(err)) {
      // bridge_receipts not applied yet: today's un-deduplicated write, never a fail-closed sender.
      try {
        await prisma.auditEvent.create({ data: auditData(event) });
      } catch (auditErr) {
        console.warn("[sync/events] Audit write failed:", auditErr);
      }
      return { duplicate: false, dedupe: "unavailable" };
    }
    console.error("[sync/events] Keyed audit write failed:", err);
    throw new ServiceError("The keyed event was not recorded; retry", 503);
  }
}

/**
 * POST /api/sync/events
 * Receives business events from nickstire.org bridge.
 * Auth: Bearer STATENOUR_SYNC_KEY
 */
export const POST = apiHandler(
  async (req) => {
    const body = await req.json();
    const events: BridgeEvent[] = body.events ?? [body];
    const keys = eventKeys(events, req.headers);

    const results = [];

    for (const [index, event] of events.entries()) {
      const key = keys[index];
      let dedupe: "unavailable" | undefined;
      if (key) {
        // ADR-0019 phase 1d. A replay writes nothing and re-fires nothing: no
        // second audit row, coach event or pipeline run.
        const write = await writeAuditOnce(event, key);
        if (write.duplicate) {
          results.push({ type: event.type, stored: false, duplicate: true, resultRef: write.resultRef });
          continue;
        }
        dedupe = write.dedupe;
      } else {
        try {
          // Store every event as an audit record
          await prisma.auditEvent.create({ data: auditData(event) });
        } catch (auditErr) {
          console.warn("[sync/events] Audit write failed:", auditErr);
          // Don't fail the whole request for an audit write failure
        }
      }

      try {
        // Create drift alert for negative reviews
        if (event.type === "nickstire:review" && (event.data?.rating as number) <= 3) {
          const today_ = today();
          // Bridge fields first (config/nickstire-bridge-events.json); older names as fallbacks.
          const author = event.data?.customerName ?? event.data?.author ?? "customer";
          const text = event.data?.reviewText ?? event.data?.text ?? "";
          const message = `${event.data?.rating}★ review from ${author}: ${String(text).substring(0, 120)}`;
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
          const message = `Callback: ${event.data?.customer ?? event.data?.name ?? "Unknown"} — ${event.data?.phone ?? "no phone"}`;
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

      results.push(dedupe ? { type: event.type, stored: true, dedupe } : { type: event.type, stored: true });

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
        "nickstire:call_completed": "call",
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
