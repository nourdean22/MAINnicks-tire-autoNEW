import { describe, it, expect } from "vitest";
import { pickGatewayDevice } from "./gateway-device";

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
