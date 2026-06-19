/**
 * Pick the operative SMS-gateway device from Capevace's `/device` list.
 *
 * The Capevace account can hold more than one device (e.g. an old test phone
 * alongside the live F25e) and the array order is NOT guaranteed. Blindly taking
 * `devices[0]` can report a stale device's status — making a health check either
 * false-alarm or, worse, claim "online" while the real sender is dead.
 *
 * Prefer an explicit `SHOP_SMS_GATEWAY_DEVICE_ID`; otherwise fall back to the
 * freshest device by `lastSeen` (the one actually sending traffic). Returns
 * `undefined` when the list is empty, or when a configured id matches nothing
 * (caller should treat that exactly like an offline gateway).
 *
 * Mirrors the selection logic in `server/cron/jobs/smsGatewayHealthMonitor.ts`.
 */
export function pickGatewayDevice<T extends { id: string; lastSeen?: string }>(
  devices: readonly T[],
  targetId?: string,
): T | undefined {
  if (!devices.length) return undefined;
  if (targetId) return devices.find((d) => d.id === targetId);
  return devices.reduce((freshest, d) => {
    const t = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
    const ft = freshest.lastSeen ? new Date(freshest.lastSeen).getTime() : 0;
    return t > ft ? d : freshest;
  });
}
