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

/**
 * 2026-10-30 · Ring/Tuya W0. A Tuya LAN `local_key` is a device credential (it
 * commands the lock on the home network). The April agent sent it in
 * `metadata` (local-agent/tuya_agent.py:173); tinytuya's devices.json calls it
 * `key`. Never stored, never served: every metadata write and bridge-key read
 * passes through here.
 */
const DEVICE_SECRET_KEYS = new Set(["local_key", "localKey", "key"]);

export function stripDeviceSecrets<T>(metadata: T): T {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata;
  return Object.fromEntries(
    Object.entries(metadata as Record<string, unknown>).filter(([k]) => !DEVICE_SECRET_KEYS.has(k)),
  ) as T;
}

/** A device row with its metadata secrets removed, for any response body. */
export function redactDevice<T extends { metadata?: unknown }>(device: T): T {
  return { ...device, metadata: stripDeviceSecrets(device.metadata) };
}

/**
 * 2026-10-30 · Ring/Tuya W0. The lock and the water heater are physical. Chat
 * may not queue a command for them, nor a verb that locks, heats, arms or
 * passes raw vendor codes to any device, until Nour's per-command approval is
 * wired (wave W4). The name check covers rows the old agent mislabelled (it
 * typed Tuya's water-heater category `rs` as IR_REMOTE).
 */
const GATED_DEVICE_TYPES = new Set(["LOCK", "HEATER", "THERMOSTAT"]);
const GATED_NAME = /lock|heater|thermostat|door/i;
const GATED_VERBS = new Set(["lock", "unlock", "set_temp", "arm", "disarm", "raw"]);

export function normalizeDeviceVerb(command: string): string {
  return command.trim().toLowerCase();
}

/** Why chat may not queue this command; null when it may. */
export function physicalSafetyRefusal(target: { name: string; deviceType: string }, command: string): string | null {
  const verb = normalizeDeviceVerb(command);
  if (GATED_VERBS.has(verb)) return `"${verb}" changes a lock, heat or alarm`;
  if (GATED_DEVICE_TYPES.has(target.deviceType.toUpperCase()) || GATED_NAME.test(target.name)) {
    return `${target.name} is a lock or heater`;
  }
  return null;
}

/** The cuid for a cuid OR a platformDeviceId; null when neither matches. */
export async function resolveDeviceId(idOrPlatformId: string): Promise<string | null> {
  const device = await resolveDevice(idOrPlatformId);
  return device?.id ?? null;
}
