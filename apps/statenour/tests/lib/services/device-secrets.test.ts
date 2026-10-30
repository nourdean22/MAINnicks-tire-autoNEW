/**
 * Device secrets never stored, never served · 2026-10-30 · Ring/Tuya W0.
 *
 * The April home agent (local-agent/tuya_agent.py:173) put each Tuya device's
 * LAN `local_key` into `metadata`; the sync route stored it on create and
 * GET /api/devices (bridge key) returned whole rows. A local key is a device
 * credential: whoever holds it can command the lock on the LAN.
 */
import { describe, it, expect } from "vitest";
import { stripDeviceSecrets } from "@/lib/services/devices";

describe("stripDeviceSecrets", () => {
  it("drops every spelling of the Tuya local key and keeps the rest", () => {
    const meta = { category: "ms", product_name: "Lock", local_key: "k1", localKey: "k2", key: "k3", uuid: "u" };
    expect(stripDeviceSecrets(meta)).toEqual({ category: "ms", product_name: "Lock", uuid: "u" });
  });

  it("does not mutate the input object", () => {
    const meta = { local_key: "k1", model: "x" };
    stripDeviceSecrets(meta);
    expect(meta).toEqual({ local_key: "k1", model: "x" });
  });

  it("passes null, undefined and non-objects through unchanged", () => {
    expect(stripDeviceSecrets(null)).toBeNull();
    expect(stripDeviceSecrets(undefined)).toBeUndefined();
    expect(stripDeviceSecrets("text" as unknown)).toBe("text");
  });

  it("positive control: metadata with no secret comes back equal", () => {
    expect(stripDeviceSecrets({ model: "x" })).toEqual({ model: "x" });
  });
});
