import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

/**
 * POST /api/sync/vision — Receive vision events from the local PowerShell system.
 * The V380 watcher and vision module push events here so the AI can reference them.
 *
 * Body: { events: Array<{ timestamp, event, camera?, data?, source? }> }
 * Or single: { timestamp, event, camera?, data?, source? }
 */
export const POST = apiHandler(async (req) => {
  const body = await req.json();

  // Accept single event or array
  const events = Array.isArray(body.events) ? body.events : [body];

  if (events.length === 0) {
    throw new ServiceError("No events provided", 400);
  }

  const created = await prisma.visionEvent.createMany({
    data: events.map((e: { timestamp?: string; event: string; camera?: string; data?: unknown; source?: string }) => ({
      timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
      event: e.event,
      camera: e.camera || null,
      data: e.data || null,
      source: e.source || "local",
    })),
    skipDuplicates: true,
  });

  // Log the sync
  await prisma.localSyncLog.create({
    data: {
      module: "vision",
      action: "sync_events",
      count: created.count,
      details: `Synced ${created.count} vision events`,
    },
  });

  return {
    ok: true,
    synced: created.count,
    message: `${created.count} vision events synced to cloud`,
  };
}, { auth: "sync" });

/**
 * GET /api/sync/vision — Get recent vision events (for dashboard display)
 */
export const GET = apiHandler(async (req) => {
  const { searchParams } = new URL(req.url);
  const camera = searchParams.get("camera");
  const limit = parseInt(searchParams.get("limit") || "20");

  const where: Record<string, unknown> = {};
  if (camera) where.camera = camera;

  const events = await prisma.visionEvent.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: Math.min(limit, 100),
  });

  // Summary stats
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const todayEvents = await prisma.visionEvent.count({
    where: { timestamp: { gte: new Date(todayStr) } },
  });

  const analysisCount = await prisma.visionEvent.count({
    where: {
      event: { contains: "analysis" },
      timestamp: { gte: new Date(todayStr) },
    },
  });

  return {
    events,
    stats: {
      total: events.length,
      today: todayEvents,
      analysesToday: analysisCount,
    },
  };
}, { auth: "sync" });
