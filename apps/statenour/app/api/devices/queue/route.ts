import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSyncAuth } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { logger } from "@/lib/logger";

const log = logger.withSurface("api/devices/queue");

export const runtime = "nodejs";
export const maxDuration = 10;

/**
 * GET /api/devices/queue
 *
 * Agent-facing batch endpoint. The local desktop agent
 * (nour-os-unified) polls this every 15-30s to claim a batch of
 * pending DeviceCommand rows across ALL devices instead of the
 * existing per-device /api/devices/[id]/command endpoint.
 *
 * Auth: uses the SAME x-sync-key / SYNC_KEY contract as every
 * other agent-facing endpoint on statenour-os (see requireSyncAuth).
 * No new secret to manage.
 *
 * Query params:
 *   ?platform=TUYA,RING — filter by platform (agent can claim only
 *                          the platforms it knows how to execute)
 *   ?limit=10 — cap batch size (MAX_BATCH = 20)
 *
 * Response:
 *   { commands: [{ id, deviceId, command, params,
 *                  device:{platform, platformDeviceId, name,
 *                          deviceType, location} }],
 *     count, now: ISO }
 *
 * Each returned command is immediately marked status="sent" with
 * sentAt=now so the agent doesn't re-claim on the next poll. The
 * ack endpoint (PATCH /api/devices/command/[id]) is idempotent so
 * a fresh ack on retry works cleanly. If the agent crashes before
 * acking, each poll reclaims it (03-F16): unacked 1 h after sentAt
 * -> back to "pending" ONCE (marked in `error`); unacked 1 h after
 * that re-send -> "failed". Never re-sent a second time.
 */

const MAX_BATCH = 20;
const SENT_ACK_TIMEOUT_MS = 60 * 60 * 1000;
const RECLAIM_MARK = "reclaimed: no ack within 1h of send; re-sent once";

export async function GET(req: NextRequest) {
  try {
    requireSyncAuth(req);
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { error: err.message, code: "AGENT_AUTH_FAILED" },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: "unauthorized", code: "AGENT_AUTH_FAILED" },
      { status: 401 }
    );
  }

  try {
    const url = new URL(req.url);
    const platformsRaw = url.searchParams.get("platform");
    const platforms = platformsRaw
      ? platformsRaw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
      : null;
    const limit = Math.min(
      MAX_BATCH,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "10", 10))
    );

    // Bounded reclaim of unacked "sent" commands. Strike two first: an
    // already-reclaimed command that is stale again fails for good. Then
    // strike one: any other stale "sent" goes back to pending, marked.
    const staleBefore = new Date(Date.now() - SENT_ACK_TIMEOUT_MS);
    const failed = await prisma.deviceCommand.updateMany({
      where: { status: "sent", sentAt: { lt: staleBefore }, error: RECLAIM_MARK },
      data: { status: "failed", error: "no ack within 1h, twice (sent, then re-sent once); not retried again" },
    });
    const reclaimed = await prisma.deviceCommand.updateMany({
      where: { status: "sent", sentAt: { lt: staleBefore } },
      data: { status: "pending", sentAt: null, error: RECLAIM_MARK },
    });
    if (failed.count > 0 || reclaimed.count > 0) {
      log.warn("device_commands_unacked", { reclaimed: reclaimed.count, failed: failed.count });
    }

    // Read candidates, then claim each with a compare-and-swap on the
    // status we read. Only rows whose own flip to "sent" won are returned:
    // a concurrent poller that read the same rows gets count 0 and skips
    // them, so a command reaches exactly one agent.
    const candidates = await prisma.deviceCommand.findMany({
      where: {
        status: "pending",
        ...(platforms
          ? { device: { platform: { in: platforms } } }
          : {}),
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: {
        device: {
          select: {
            id: true,
            name: true,
            platform: true,
            platformDeviceId: true,
            deviceType: true,
            location: true,
          },
        },
      },
    });

    const sentAt = new Date();
    const won = await Promise.all(
      candidates.map((c) =>
        prisma.deviceCommand.updateMany({
          where: { id: c.id, status: "pending" },
          data: { status: "sent", sentAt },
        }),
      ),
    );
    const pending = candidates.filter((_, i) => won[i].count === 1);

    return NextResponse.json({
      commands: pending.map((c) => ({
        id: c.id,
        deviceId: c.deviceId,
        command: c.command,
        params: c.params,
        createdAt: c.createdAt,
        device: c.device,
      })),
      count: pending.length,
      now: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "queue fetch failed",
        code: "QUEUE_FETCH_FAILED",
      },
      { status: 500 }
    );
  }
}
