/**
 * The home device agent's door · 2026-10-30 · Ring/Tuya W0.
 *
 * A machine on Nour's home Wi-Fi must not hold STATENOUR_SYNC_KEY (the whole
 * cross-app bridge: tasks, body, nour-os sync). DEVICE_AGENT_KEY opens only
 * the device routes. Same shape as EVIDENCE_LEDGER_KEY
 * (tests/security/evidence-ledger-auth.test.ts): the REAL pure decision,
 * positive control first, then the refusals, then the scope claim.
 */
import { describe, it, expect } from "vitest";
import { deviceDoorAccepts } from "@/lib/security/device-agent-auth";
import { evidenceDoorAccepts } from "@/lib/security/evidence-ledger-auth";

const DEVICE = "device-key-0123456789abcdef";
const BRIDGE = "bridge-key-fedcba9876543210";

describe("deviceDoorAccepts", () => {
  it("positive control: the scoped key opens as 'device', the bridge key as 'bridge'", () => {
    const env = { DEVICE_AGENT_KEY: DEVICE, STATENOUR_SYNC_KEY: BRIDGE };
    expect(deviceDoorAccepts(DEVICE, env)).toBe("device");
    expect(deviceDoorAccepts(BRIDGE, env)).toBe("bridge");
  });

  it("refuses a wrong key, an empty key, and a near-miss of the right length", () => {
    const env = { DEVICE_AGENT_KEY: DEVICE, STATENOUR_SYNC_KEY: BRIDGE };
    expect(deviceDoorAccepts("nope", env)).toBeNull();
    expect(deviceDoorAccepts("", env)).toBeNull();
    expect(deviceDoorAccepts(DEVICE.slice(0, -1) + "X", env)).toBeNull();
  });

  it("fails closed when nothing is configured", () => {
    expect(deviceDoorAccepts("", { DEVICE_AGENT_KEY: "", STATENOUR_SYNC_KEY: undefined })).toBeNull();
    expect(deviceDoorAccepts(DEVICE, { DEVICE_AGENT_KEY: undefined, STATENOUR_SYNC_KEY: undefined })).toBeNull();
  });

  it("scope: the device key opens no other door (evidence door shown; the bridge door compares STATENOUR_SYNC_KEY only)", () => {
    const env = { EVIDENCE_LEDGER_KEY: "ledger-key-xxxxxxxxxxxxxxxx", STATENOUR_SYNC_KEY: BRIDGE, DEVICE_AGENT_KEY: DEVICE };
    expect(evidenceDoorAccepts(DEVICE, env)).toBeNull();
  });
});
