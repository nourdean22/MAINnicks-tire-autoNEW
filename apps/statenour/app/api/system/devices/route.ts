import { apiHandler } from "@/lib/utils/http";
import { buildDeviceFleet } from "@/lib/services/system-pages";

/**
 * GET /api/system/devices — full device health feed (W3).
 *
 * Aggregates SmartDevice + DeviceCommand + DeviceEvent into one
 * composite. Powers /system/devices. The existing /devices page uses
 * a per-device detail surface; this is the fleet-level command deck.
 *
 * Phase B.7a (2026-05-22) · the fleet-composite assembly moved to the
 * shared `system-pages.buildDeviceFleet` service so the legacy REST
 * consumer AND the new `system.deviceFleet` tRPC procedure can't drift.
 * This route stays mounted as the coexistence / rollback path.
 */
export const GET = apiHandler(async () => buildDeviceFleet(), {
  auth: "owner",
}); // v9.1.17 · added by add-get-route-auth.ts
