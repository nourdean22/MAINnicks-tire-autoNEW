import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

import { requireSession } from "@/lib/auth-guard";
export const runtime = "nodejs";
export const maxDuration = 10;

/**
 * POST /api/devices/command
 *
 * Enqueue a device command. The local desktop agent
 * (nour-os-unified) polls /api/devices/queue, executes the command
 * via its vendor bridges (Ring/Eufy/Tuya/Google), and PATCHes back
 * the result.
 *
 * Body:
 *   { deviceId: string, command: string, params?: object }
 *
 * Creates a DeviceCommand row with status="pending". The command
 * string is opaque to statenour-os — the agent interprets it per
 * the device's platform. Common verbs: turn_on · turn_off ·
 * set_temp · lock · unlock · snapshot · record · arm · disarm.
 *
 * Response:
 *   { commandId, status: "pending", device: { id, name, platform } }
 *
 * The caller (UI or tool) can poll GET /api/devices/command/[id]
 * for acks, or subscribe via the Ultron signal zone to see
 * completions flow through as device events.
 */

type CommandBody = {
  deviceId?: string;
  command?: string;
  params?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  await requireSession(req);
  try {
    const body = (await req.json()) as CommandBody;
    const { deviceId, command, params } = body;

    if (!deviceId || !command) {
      return NextResponse.json(
        {
          error: "deviceId and command are required",
          code: "BAD_REQUEST",
        },
        { status: 400 }
      );
    }
    if (command.length > 80) {
      return NextResponse.json(
        { error: "command too long (max 80 chars)", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const device = await prisma.smartDevice.findUnique({
      where: { id: deviceId },
      select: {
        id: true,
        name: true,
        platform: true,
        status: true,
        platformDeviceId: true,
      },
    });
    if (!device) {
      return NextResponse.json(
        { error: "device not found", code: "DEVICE_NOT_FOUND" },
        { status: 404 }
      );
    }

    // Refuse commands to devices we think are permanently offline —
    // the desktop agent would just error, and the pending queue
    // would pile up. Better to 409 here.
    if (device.status === "OFFLINE") {
      return NextResponse.json(
        {
          error: "device offline — command not enqueued",
          code: "DEVICE_OFFLINE",
          device: { id: device.id, name: device.name, status: device.status },
        },
        { status: 409 }
      );
    }

    const row = await prisma.deviceCommand.create({
      data: {
        deviceId: device.id,
        command,
        params: params ? (params as any) : undefined,
        status: "pending",
      },
      select: { id: true, status: true, createdAt: true },
    });

    return NextResponse.json({
      commandId: row.id,
      status: row.status,
      enqueuedAt: row.createdAt,
      device: {
        id: device.id,
        name: device.name,
        platform: device.platform,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "command enqueue failed",
        code: "COMMAND_ENQUEUE_FAILED",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/devices/command?deviceId=X — recent commands for a device
 */
export async function GET(req: NextRequest) {
  // v10.0.37 — CRITICAL fix. Pre-v10.0.37 this GET had no auth.
  // Returned device-command history including the raw `params`
  // payload (camera arm/disarm, lock codes, temperature setpoints).
  // POST already required auth; GET was the gap.
  await requireSession(req);
  try {
    const url = new URL(req.url);
    const deviceId = url.searchParams.get("deviceId");
    const limit = Math.min(
      50,
      parseInt(url.searchParams.get("limit") ?? "20", 10)
    );

    const where = deviceId ? { deviceId } : {};
    const commands = await prisma.deviceCommand.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        deviceId: true,
        command: true,
        params: true,
        status: true,
        sentAt: true,
        ackedAt: true,
        error: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ commands, count: commands.length });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "fetch failed",
        code: "COMMAND_FETCH_FAILED",
      },
      { status: 500 }
    );
  }
}
