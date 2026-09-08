import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { resolveDevice } from "@/lib/services/devices";

export const dynamic = "force-dynamic";

// 2026-09-08 · ADR-0017 / master-plan C1. `:id` is the cuid OR the bridge's
// `platformDeviceId`. GET used to return `{commands: [], count: 0}` for an
// unknown device — the same silent-zero shape as the P0, one layer quieter.

/**
 * GET /api/devices/:id/command — Get pending commands for a device (local agent polls this)
 */
export const GET = apiHandler(async (_req, { params }) => {
  const { id } = await params!;
  const device = await resolveDevice(id);
  if (!device) {
    throw new ServiceError("Device not found", 404);
  }

  const commands = await prisma.deviceCommand.findMany({
    where: { deviceId: device.id, status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  return { commands, count: commands.length };
}, { auth: "sync" });

/**
 * POST /api/devices/:id/command — Queue a command for a device
 * Body: { command: "turn_on", params?: {...} }
 */
export const POST = apiHandler(async (req, { params }) => {
  const { id } = await params!;

  const device = await resolveDevice(id);
  if (!device) {
    throw new ServiceError("Device not found", 404);
  }

  const body = await req.json();

  const cmd = await prisma.deviceCommand.create({
    data: {
      deviceId: device.id,
      command: body.command,
      params: body.params || null,
      status: "pending",
    },
  });

  return { command: cmd };
}, { auth: "owner" }); // Changed from "sync" — dashboard user sends commands via session auth

/**
 * PATCH /api/devices/:id/command — Acknowledge a command (local agent calls this after executing)
 * Body: { commandId: "...", status: "acked"|"failed", error?: "..." }
 */
export const PATCH = apiHandler(async (req, { params }) => {
  await params!; // consume params

  try {
    const body = await req.json();

    const cmd = await prisma.deviceCommand.update({
      where: { id: body.commandId },
      data: {
        status: body.status || "acked",
        ackedAt: body.status === "acked" ? new Date() : undefined,
        sentAt: new Date(),
        error: body.error || null,
      },
    });

    return { command: cmd };
  } catch {
    throw new ServiceError("Command not found", 404);
  }
}, { auth: "sync" });
