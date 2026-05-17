import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSyncAuth } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";

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
 * sentAt=now so the agent doesn't re-claim on the next poll. If
 * the agent crashes before acking, the command stays "sent" — the
 * ack endpoint (PATCH /api/devices/command/[id]) is idempotent so
 * a fresh ack on retry works cleanly. A "resurrect stuck sents"
 * cron could later flip sents > N min back to pending if needed;
 * not built yet because volume is low.
 */

const MAX_BATCH = 20;

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

    // Transactional: fetch pending rows, immediately flip to "sent"
    // in a single query. Postgres skip-locked semantics aren't
    // available in this adapter path so we use a two-step with a
    // narrow where-clause to minimize races between multiple agents.
    const pending = await prisma.deviceCommand.findMany({
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

    if (pending.length > 0) {
      await prisma.deviceCommand.updateMany({
        where: { id: { in: pending.map((p) => p.id) }, status: "pending" },
        data: { status: "sent", sentAt: new Date() },
      });
    }

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
