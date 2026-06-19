import { describe, it, expect } from "vitest";
import { pickGatewayDevice, isGatewayOnline, GATEWAY_OFFLINE_MINUTES } from "./gateway-device";

describe("pickGatewayDevice", () => {
  const older = { id: "older", lastSeen: "2026-06-19T10:00:00Z" };
  const fresher = { id: "fresher", lastSeen: "2026-06-19T12:00:00Z" };
  const noSeen = { id: "no-seen" };

  it("returns undefined for an empty list", () => {
    expect(pickGatewayDevice([])).toBeUndefined();
    expect(pickGatewayDevice([], "anything")).toBeUndefined();
  });

  it("returns the device matching SHOP_SMS_GATEWAY_DEVICE_ID when set", () => {
    expect(pickGatewayDevice([older, fresher], "older")).toBe(older);
  });

  it("returns undefined when a configured id matches nothing (treated as offline)", () => {
    expect(pickGatewayDevice([older, fresher], "missing-id")).toBeUndefined();
  });

  it("falls back to the freshest device by lastSeen when no id is configured", () => {
    expect(pickGatewayDevice([older, fresher])).toBe(fresher);
    // order-independent
    expect(pickGatewayDevice([fresher, older])).toBe(fresher);
  });

  it("does not crash and still picks the freshest when some devices lack lastSeen", () => {
    expect(pickGatewayDevice([noSeen])).toBe(noSeen);
    expect(pickGatewayDevice([noSeen, fresher])).toBe(fresher);
    expect(pickGatewayDevice([fresher, noSeen])).toBe(fresher);
  });
});

/**
 * Regression lock for the gateway "online" threshold.
 *
 * Before: the live `sms.gatewayHealth` resolver used `ageMin < 10` while the
 * alerting cron used 30 min. The F25e relay heartbeats into Capevace roughly
 * every ~15 min, so a HEALTHY gateway routinely sits in the 10–17 min band —
 * where the 10-min resolver flipped every admin badge (Overview/Tires/Winback)
 * to OFFLINE while the cron logged "online". One shared constant fixes it.
 */
describe("isGatewayOnline — single shared gateway-offline threshold", () => {
  it("reads a 15-minute-old check-in as ONLINE (a normal ~15min relay gap must not flap offline)", () => {
    expect(isGatewayOnline(15)).toBe(true);
  });

  it("is online just under the threshold and offline at/over it", () => {
    expect(isGatewayOnline(GATEWAY_OFFLINE_MINUTES - 1)).toBe(true); // 29 -> online
    expect(isGatewayOnline(GATEWAY_OFFLINE_MINUTES)).toBe(false); // 30 -> offline (matches cron `>=`)
    expect(isGatewayOnline(GATEWAY_OFFLINE_MINUTES + 1)).toBe(false); // 31 -> offline
  });

  it("uses a 30-minute window (two missed ~15min check-ins) so the live badge matches the alerting cron", () => {
    expect(GATEWAY_OFFLINE_MINUTES).toBe(30);
  });
});
