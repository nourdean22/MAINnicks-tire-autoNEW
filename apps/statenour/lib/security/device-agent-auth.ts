/**
 * Home device agent door auth — the pure decision, next-auth-free so tests
 * import the REAL function (same pattern as evidence-ledger-auth.ts).
 *
 * Two keys open the agent-facing device routes (/api/devices/**):
 *   DEVICE_AGENT_KEY   — scoped: these routes and nothing else. What the Ring/Tuya
 *                        agent on Nour's home machine holds. Nour sets it in Railway.
 *   STATENOUR_SYNC_KEY — the cross-app bridge key the shop camera bridge already
 *                        posts with. Still accepted so nothing in flight breaks.
 * Env is read per call. Fail closed: no configured key never authenticates.
 */
import { same } from "@/lib/security/evidence-ledger-auth";

export type DeviceKeyEnv = { DEVICE_AGENT_KEY?: string; STATENOUR_SYNC_KEY?: string };

/** Which configured key, if any, the presented one matches. */
export function deviceDoorAccepts(presented: string, env: DeviceKeyEnv): "device" | "bridge" | null {
  const device = env.DEVICE_AGENT_KEY?.trim();
  const bridge = env.STATENOUR_SYNC_KEY?.trim();
  if (device && same(presented, device)) return "device";
  if (bridge && same(presented, bridge)) return "bridge";
  return null;
}
