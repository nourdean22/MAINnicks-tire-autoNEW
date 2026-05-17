import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireSyncAuth } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";

export const runtime = "nodejs";

/**
 * GET /api/devices/command/[id]
 * Read the current state of a single command. UI polls this after
 * enqueue to show ack/fail status.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // v10.0.183 · was unauthenticated. Device commands include payload
  // metadata (URLs, app actions) — leaking by ID enumeration would
  // expose what other devices have been told to do. Allow either
  // operator session OR sync key (cross-device polling needs the
  // sync path).
  try {
    await requireSession(req);
  } catch {
    await requireSyncAuth(req);
  }
  try {
    const { id } = await params;
    const cmd = await prisma.deviceCommand.findUnique({
      where: { id },
      include: {
        device: {
          select: { id: true, name: true, platform: true, status: true },
        },
      },
    });
    if (!cmd) {
      return NextResponse.json(
        { error: "command not found", code: "COMMAND_NOT_FOUND" },
        { status: 404 }
      );
    }
    return NextResponse.json({ command: cmd });
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

/**
 * PATCH /api/devices/command/[id]
 *
 * Agent-facing ack. After executing a command via vendor bridges,
 * the agent reports result here.
 *
 * Auth: X-Agent-Secret header.
 *
 * Body:
 *   { status: "acked" | "failed", error?: string,
 *     resultState?: object }
 *
 * - "acked" marks the command as successfully executed. If
 *   resultState is supplied, it's merged into SmartDevice.currentState
 *   as the new known state (e.g. { on: true } after a turn_on).
 * - "failed" records the error for review. The command is not
 *   re-queued automatically — retries are the agent's problem
 *   (prevents infinite loops on genuine vendor failures).
 *
 * Also writes a DeviceEvent row for observability so Nour can see
 * the full timeline on the device detail page.
 */

type PatchBody = {
  status?: "acked" | "failed";
  error?: string;
  resultState?: Record<string, unknown>;
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params;
    const body = (await req.json()) as PatchBody;
    if (!body.status || (body.status !== "acked" && body.status !== "failed")) {
      return NextResponse.json(
        { error: "status must be 'acked' or 'failed'", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const existing = await prisma.deviceCommand.findUnique({
      where: { id },
      select: { id: true, deviceId: true, command: true, params: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "command not found", code: "COMMAND_NOT_FOUND" },
        { status: 404 }
      );
    }

    const now = new Date();
    const updated = await prisma.deviceCommand.update({
      where: { id },
      data: {
        status: body.status,
        ackedAt: now,
        error: body.status === "failed" ? (body.error || "unknown").slice(0, 500) : null,
      },
      select: { id: true, status: true, ackedAt: true, error: true },
    });

    // Merge resultState into SmartDevice.currentState so the UI
    // sees the new known state without polling the vendor again.
    if (body.status === "acked" && body.resultState) {
      const device = await prisma.smartDevice.findUnique({
        where: { id: existing.deviceId },
        select: { currentState: true },
      });
      const prevState = (device?.currentState as Record<string, unknown>) || {};
      await prisma.smartDevice
        .update({
          where: { id: existing.deviceId },
          data: {
            currentState: { ...prevState, ...body.resultState } as any,
            lastSeenAt: now,
            status: "ONLINE",
          },
        })
        .catch(() => {});
    }

    // DeviceEvent row for the timeline
    await prisma.deviceEvent
      .create({
        data: {
          deviceId: existing.deviceId,
          event:
            body.status === "acked"
              ? `command_acked:${existing.command}`
              : `command_failed:${existing.command}`,
          data: {
            commandId: existing.id,
            command: existing.command,
            params: existing.params,
            result: body.resultState ?? null,
            error: body.error ?? null,
          } as any,
          source: "local",
          timestamp: now,
        },
      })
      .catch(() => {});

    return NextResponse.json({ command: updated });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "ack failed",
        code: "COMMAND_ACK_FAILED",
      },
      { status: 500 }
    );
  }
}
