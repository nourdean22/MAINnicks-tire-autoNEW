import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";

/** GET /api/cameras/[id]/snapshot — Get latest snapshot URL */
export const GET = apiHandler(async (req, { params }) => {
  const { id } = await params!;

  const device = await prisma.smartDevice.findUnique({
    where: { id },
    select: { id: true, name: true, currentState: true, status: true, lastSeenAt: true },
  });

  if (!device) throw new ServiceError("Camera not found", 404);

  const state = device.currentState as Record<string, unknown> | null;
  return {
    deviceId: device.id,
    name: device.name,
    snapshotUrl: state?.snapshotUrl ?? null,
    isOnline: device.status === "ONLINE",
    lastSeenAt: device.lastSeenAt,
  };
}, { auth: "owner" });

/** POST /api/cameras/[id]/snapshot — Trigger manual snapshot via local agent */
export const POST = apiHandler(async (req, { params }) => {
  const { id } = await params!;

  const device = await prisma.smartDevice.findUnique({
    where: { id },
    select: { id: true, name: true, platform: true },
  });

  if (!device) throw new ServiceError("Camera not found", 404);

  // Queue a snapshot command for the local agent
  const command = await prisma.deviceCommand.create({
    data: {
      deviceId: id,
      command: "snapshot",
      params: { manual: true },
      status: "pending",
    },
  });

  return {
    commandId: command.id,
    device: device.name,
    status: "queued",
    message: "Snapshot command queued. Local agent will capture and sync.",
  };
}, { auth: "sync" });
