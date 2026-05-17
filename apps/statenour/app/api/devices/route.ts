import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/devices — List all smart devices, optionally filtered
 */
export const GET = apiHandler(async (req) => {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get("platform");
  const location = searchParams.get("location");
  const status = searchParams.get("status");

  const where: Record<string, unknown> = {};
  if (platform) where.platform = platform;
  if (location) where.location = location;
  if (status) where.status = status;

  const devices = await prisma.smartDevice.findMany({
    where,
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { events: true, commands: true } },
    },
  });

  return { devices, count: devices.length };
}, { auth: "sync" });

/**
 * POST /api/devices — Register a new device or bulk upsert
 * Body: { device: {...} } or { devices: [...] }
 */
export const POST = apiHandler(async (req) => {
  const body = await req.json();
  const items = body.devices || [body.device || body];

  // Batch the upserts into a single $transaction. Previously
  // `for (const d of items) await prisma.smartDevice.upsert(...)`
  // = N sequential round-trips to Neon. With 10 devices in the
  // local-agent sync that's ~500ms of pure latency. $transaction
  // bundles them into ONE round-trip with atomic semantics —
  // either every upsert lands or none, no half-applied syncs.
  const results = await prisma.$transaction(
    items.map((d: Record<string, unknown>) =>
      prisma.smartDevice.upsert({
        where: { platformDeviceId: d.platformDeviceId as string },
        create: {
          name: d.name as string,
          platform: d.platform as string,
          platformDeviceId: d.platformDeviceId as string,
          deviceType: (d.deviceType as string) || "OTHER",
          location: (d.location as string) || null,
          status: (d.status as string) || "UNKNOWN",
          lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt as string) : null,
          capabilities: (d.capabilities as object) || null,
          currentState: (d.currentState as object) || null,
          metadata: (d.metadata as object) || null,
        },
        update: {
          name: d.name as string,
          status: (d.status as string) || undefined,
          lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt as string) : undefined,
          currentState: (d.currentState as object) || undefined,
          metadata: (d.metadata as object) || undefined,
          location: (d.location as string) || undefined,
        },
      }),
    ),
  );

  await prisma.localSyncLog.create({
    data: {
      module: "devices",
      action: "upsert_devices",
      count: results.length,
      details: `Upserted ${results.length} devices`,
    },
  });

  return { devices: results, count: results.length };
}, { auth: "sync" });
