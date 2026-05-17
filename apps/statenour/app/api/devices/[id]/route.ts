import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/devices/:id — Get single device with recent events
 */
export const GET = apiHandler(async (_req, { params }) => {
  const { id } = await params!;

  const device = await prisma.smartDevice.findUnique({
    where: { id },
    include: {
      events: { orderBy: { timestamp: "desc" }, take: 20 },
      commands: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  if (!device) {
    throw new ServiceError("Device not found", 404);
  }

  return { device };
}, { auth: "sync" });

/**
 * PATCH /api/devices/:id — Update device status/state
 */
export const PATCH = apiHandler(async (req, { params }) => {
  const { id } = await params!;
  const body = await req.json();

  try {
    const device = await prisma.smartDevice.update({
      where: { id },
      data: {
        name: body.name || undefined,
        status: body.status || undefined,
        location: body.location || undefined,
        lastSeenAt: body.lastSeenAt ? new Date(body.lastSeenAt) : undefined,
        currentState: body.currentState || undefined,
        capabilities: body.capabilities || undefined,
        metadata: body.metadata || undefined,
      },
    });

    return { device };
  } catch {
    throw new ServiceError("Device not found", 404);
  }
}, { auth: "sync" });

/**
 * DELETE /api/devices/:id — Retire a device (v11.1 G6).
 *
 * Owner-auth (not sync) — human action. Cascades events + queued
 * commands so the row doesn't orphan FKs.
 */
export const DELETE = apiHandler(
  async (_req, { params }) => {
    const { id } = await params!;
    try {
      await prisma.deviceCommand.deleteMany({ where: { deviceId: id } }).catch(() => ({ count: 0 }));
      await prisma.deviceEvent.deleteMany({ where: { deviceId: id } }).catch(() => ({ count: 0 }));
      const device = await prisma.smartDevice.delete({ where: { id } });
      return { retired: true, device: { id: device.id, name: device.name } };
    } catch {
      throw new ServiceError("Device not found", 404);
    }
  },
  { auth: "owner" },
);
