import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/devices/:id/events — Get events for a device
 */
export const GET = apiHandler(async (req, { params }) => {
  const { id } = await params!;
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const event = searchParams.get("event");

  const where: Record<string, unknown> = { deviceId: id };
  if (event) where.event = event;

  const events = await prisma.deviceEvent.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: Math.min(limit, 200),
  });

  return { events, count: events.length };
}, { auth: "sync" });

/**
 * POST /api/devices/:id/events — Push events for a device
 * Body: { events: [...] } or { event, data?, source?, timestamp? }
 */
export const POST = apiHandler(async (req, { params }) => {
  const { id } = await params!;

  // Verify device exists
  const device = await prisma.smartDevice.findUnique({ where: { id } });
  if (!device) {
    throw new ServiceError("Device not found", 404);
  }

  const body = await req.json();
  const items = body.events || [body];

  const vehicleEvents = items.filter((e: any) => e.event === "vehicle_detected");
  const otherEvents = items.filter((e: any) => e.event !== "vehicle_detected");

  let syncedCount = 0;

  if (otherEvents.length > 0) {
    const created = await prisma.deviceEvent.createMany({
      data: otherEvents.map((e: { event: string; data?: unknown; source?: string; timestamp?: string }) => ({
        deviceId: id,
        event: e.event,
        data: e.data || null,
        source: e.source || "local",
        timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
      })),
    });
    syncedCount += created.count;
  }

  if (vehicleEvents.length > 0) {
    const { handleVehicleEvent } = await import("@/lib/services/vehicle-detection");
    for (const e of vehicleEvents) {
      await handleVehicleEvent(id, e);
      syncedCount++;
    }
  }

  // Update device lastSeenAt
  await prisma.smartDevice.update({
    where: { id },
    data: { lastSeenAt: new Date(), status: "ONLINE" },
  });

  return { synced: syncedCount };
}, { auth: "sync" });
