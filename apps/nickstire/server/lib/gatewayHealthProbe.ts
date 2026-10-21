/**
 * Live read of the shop SMS gateway phone (Capevace `/device`), for the
 * `sms.gatewayHealth` admin query.
 *
 * Two promises the Today board depends on:
 *  - Bounded. tRPC batches wait for their slowest member, so a hung vendor must
 *    not hold the whole first load. The read gives up after
 *    GATEWAY_PROBE_TIMEOUT_MS and says `readable: false` (could not ask), never
 *    a made-up online or offline.
 *  - Cheap to repeat. Several admin panels ask within seconds of each other, so
 *    a SUCCESSFUL device list is kept for GATEWAY_PROBE_TTL_MS. Only the raw
 *    list is kept; online/age are recomputed from `lastSeen` at read time so a
 *    cached answer can never keep a silent phone online. A failed read is
 *    never kept.
 */
import { isGatewayOnline, pickGatewayDevice } from "./gateway-device";

/**
 * Under the 4 s ceiling adminReadLatencyBound.test.ts asserts, and far under the
 * 8 s this read used before (a hung vendor held Today's first load that long).
 * A healthy /device list is a small JSON array; the vendor is the only slow part.
 */
const GATEWAY_PROBE_TIMEOUT_MS = 3_000;
/** One heartbeat is ~15 min and offline is 30 min, so 60 s of memory changes no verdict. */
const GATEWAY_PROBE_TTL_MS = 60_000;

type Device = { id: string; name?: string; lastSeen?: string };
function isDeviceList(v: unknown): v is Device[] {
  return Array.isArray(v) && v.every((d) => typeof d === "object" && d !== null && typeof (d as { id?: unknown }).id === "string");
}
let cached: { key: string; devices: Device[]; at: number } | null = null;

/** Test hook: forget the last successful probe. */
export function resetGatewayHealthCache(): void {
  cached = null;
}

export async function probeGatewayHealth() {
  const username = process.env.SHOP_SMS_GATEWAY_USERNAME;
  const password = process.env.SHOP_SMS_GATEWAY_PASSWORD;
  const baseUrl = process.env.SHOP_SMS_GATEWAY_URL || "https://api.sms-gate.app/3rdparty/v1";
  if (!username || !password) {
    return { configured: false as const, readable: true, online: false, lastSeen: null, deviceName: null, error: "SHOP_SMS_GATEWAY_USERNAME/PASSWORD not set" };
  }
  const key = `${baseUrl}\n${username}`;
  let devices: Device[];
  if (cached && cached.key === key && Date.now() - cached.at < GATEWAY_PROBE_TTL_MS) {
    devices = cached.devices;
  } else {
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    try {
      const res = await fetch(`${baseUrl}/device`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(GATEWAY_PROBE_TIMEOUT_MS),
      });
      if (!res.ok) {
        // readable: false · the vendor API failed, so the phone's state is UNKNOWN,
        // not offline. Q-23 phase 9: the admin must not blame the device for it.
        return { configured: true as const, readable: false, online: false, lastSeen: null, deviceName: null, error: `Capevace /device returned ${res.status}` };
      }
      const body: unknown = await res.json();
      // A 200 that is not a device list (null, an error object) is "could not ask": never kept, never a throw.
      if (!isDeviceList(body)) {
        return { configured: true as const, readable: false, online: false, lastSeen: null, deviceName: null, error: "Capevace /device returned an unexpected body" };
      }
      devices = body;
      cached = { key, devices, at: Date.now() };
    } catch (err) {
      return {
        configured: true as const,
        readable: false,
        online: false,
        lastSeen: null,
        deviceName: null,
        error: err instanceof Error ? err.message : "Unreachable",
      };
    }
  }
  if (!devices.length) {
    return { configured: true as const, readable: true, online: false, lastSeen: null, deviceName: null, error: "No devices registered" };
  }
  // Don't blindly trust devices[0] — the Capevace account can hold a stale
  // test phone alongside the live F25e, and order isn't guaranteed. Prefer
  // the configured device id, else the freshest by lastSeen (shared helper).
  const dev = pickGatewayDevice(devices, process.env.SHOP_SMS_GATEWAY_DEVICE_ID);
  if (!dev) {
    return {
      configured: true as const,
      readable: true,
      online: false,
      lastSeen: null,
      deviceName: null,
      error: `Configured gateway device ${process.env.SHOP_SMS_GATEWAY_DEVICE_ID} not registered (${devices.length} device(s) found)`,
    };
  }
  const lastSeenMs = dev.lastSeen ? new Date(dev.lastSeen).getTime() : 0;
  const ageMin = lastSeenMs ? Math.round((Date.now() - lastSeenMs) / 60_000) : 999;
  return {
    configured: true as const,
    readable: true,
    online: isGatewayOnline(ageMin),
    lastSeen: dev.lastSeen || null,
    ageMinutes: ageMin,
    deviceName: dev.name || null,
    deviceId: dev.id,
  };
}
