import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { resolveDevice } from "@/lib/services/devices";
import { VehicleEventSchema, ALERT_STATES } from "@/lib/services/vehicle-event-contract";

export const dynamic = "force-dynamic";

// 2026-09-08 · ADR-0017 / master-plan C1. `:id` is the cuid OR the bridge's
// `platformDeviceId` ("v380-shopsign"). Every write below uses the resolved
// cuid. Before this, the documented ingest URL 404'd on every call.

/**
 * GET /api/devices/:id/events — Get events for a device
 */
export const GET = apiHandler(async (req, { params }) => {
  const { id } = await params!;
  const device = await resolveDevice(id);
  if (!device) {
    throw new ServiceError("Device not found", 404);
  }
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const event = searchParams.get("event");

  const where: Record<string, unknown> = { deviceId: device.id };
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

  // Verify device exists (cuid or platformDeviceId)
  const device = await resolveDevice(id);
  if (!device) {
    throw new ServiceError("Device not found", 404);
  }

  const body = await req.json();
  const items = body.events || [body];

  // Gate G0 probe (master plan section 12): `?dryRun=1` or `x-dry-run: 1`
  // validates and resolves exactly what a real call would and writes
  // NOTHING - no DeviceEvent row, no lastSeenAt/ONLINE flip, no alert. A
  // "dry-run payload" through the real path would do all three.
  const { searchParams } = new URL(req.url);
  if (searchParams.get("dryRun") === "1" || req.headers.get("x-dry-run") === "1") {
    const report = (items as Array<Record<string, unknown>>).map((e) => {
      if (e.event !== "vehicle_detected") {
        return { event: e.event, valid: typeof e.event === "string" && e.event.length > 0, issues: [] as unknown[] };
      }
      const parsed = VehicleEventSchema.safeParse(e);
      const state = parsed.success ? (parsed.data.data?.state ?? "DETECTED") : null;
      return {
        event: e.event,
        valid: parsed.success,
        issues: parsed.success ? [] : parsed.error.issues.slice(0, 5),
        state,
        wouldAlert: state !== null && ALERT_STATES.has(state),
      };
    });
    return {
      dryRun: true,
      deviceId: device.id,
      platformDeviceId: device.platformDeviceId,
      valid: report.every((r) => r.valid),
      events: report,
    };
  }

  const vehicleEvents = items.filter((e: any) => e.event === "vehicle_detected");
  const otherEvents = items.filter((e: any) => e.event !== "vehicle_detected");

  let syncedCount = 0;

  if (otherEvents.length > 0) {
    const created = await prisma.deviceEvent.createMany({
      data: otherEvents.map((e: { event: string; data?: unknown; source?: string; timestamp?: string }) => ({
        deviceId: device.id,
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
      await handleVehicleEvent(device.id, e);
      syncedCount++;
    }
  }

  // Update device lastSeenAt
  await prisma.smartDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date(), status: "ONLINE" },
  });

  return { synced: syncedCount, deviceId: device.id };
}, { auth: "sync" });
