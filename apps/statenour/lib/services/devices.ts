/**
 * Device identity resolution · 2026-09-08 · ADR-0017 / master-plan C1.
 *
 * The camera bridge (camera-bridge/visitd, its README and PR #315's own
 * config) addresses a device by `platformDeviceId` ("v380-shopsign"). Every
 * `[id]` route resolved `SmartDevice.id` — a cuid the bridge can never learn —
 * so each event POST and heartbeat PATCH answered 404 "Device not found".
 * Prod receipt (2026-09-08 Neon probe): v380-shopsign = cmn7h45nu0009rls02e3rypx0,
 * v380-shopinside = cmn7h45mu0008rls0letng4og, zero `device_events` rows for
 * either. The June test device only worked because it was seeded with
 * id == platformDeviceId.
 *
 * `platformDeviceId` is `@unique`, so an OR lookup is exact. Every route
 * resolves here first and writes with the cuid.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** Prisma `where` matching either the cuid or the bridge-facing platform id. */
export function deviceWhere(idOrPlatformId: string): Prisma.SmartDeviceWhereInput {
  return { OR: [{ id: idOrPlatformId }, { platformDeviceId: idOrPlatformId }] };
}

/** The device row for a cuid OR a platformDeviceId; null when neither matches. */
export async function resolveDevice(idOrPlatformId: string) {
  if (!idOrPlatformId) return null;
  return prisma.smartDevice.findFirst({ where: deviceWhere(idOrPlatformId) });
}

/** The cuid for a cuid OR a platformDeviceId; null when neither matches. */
export async function resolveDeviceId(idOrPlatformId: string): Promise<string | null> {
  const device = await resolveDevice(idOrPlatformId);
  return device?.id ?? null;
}
