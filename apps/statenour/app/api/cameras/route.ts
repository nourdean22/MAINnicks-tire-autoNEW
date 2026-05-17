import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

/** GET /api/cameras — List all camera devices with latest snapshots */
export const GET = apiHandler(async () => {
  const cameras = await prisma.smartDevice.findMany({
    where: {
      deviceType: { in: ["CAMERA", "DOORBELL"] },
    },
    select: {
      id: true,
      name: true,
      platform: true,
      platformDeviceId: true,
      deviceType: true,
      location: true,
      status: true,
      lastSeenAt: true,
      currentState: true,
      metadata: true,
    },
    orderBy: { name: "asc" },
  });

  return {
    cameras: cameras.map((cam) => {
      const state = cam.currentState as Record<string, unknown> | null;
      return {
        ...cam,
        snapshotUrl: state?.snapshotUrl ?? null,
        isOnline: cam.status === "ONLINE",
        capabilities: getCapabilities(cam.platform, cam.deviceType),
      };
    }),
    total: cameras.length,
  };
// v10.0.121 audit-pattern follow-up · device inventory leak. Owner-gated.
}, { auth: "owner" });

function getCapabilities(platform: string, deviceType: string): string[] {
  const base = ["snapshot"];

  switch (platform) {
    case "RING":
      return [...base, "record", "live", "audio", "siren", "light"];
    case "EUFY":
      return [...base, "record", "live", "audio"];
    case "V380":
      return [...base, "record"];
    default:
      return base;
  }
}
