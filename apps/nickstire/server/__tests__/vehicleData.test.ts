import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  decodeVin,
  recallsByVehicle,
  _clearVehicleDataCache,
} from "../services/vehicleData";

/**
 * WP-23 pins (2026-07-29). NHTSA is mocked — these test OUR mapping,
 * validation, caching, and failure honesty, not the federal API.
 * Serial-suite hygiene: fetch stub restored in afterEach.
 */
const realFetch = global.fetch;

function stubFetch(payload: unknown, okStatus = true) {
  const fn = vi.fn().mockResolvedValue({
    ok: okStatus,
    status: okStatus ? 200 : 503,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => _clearVehicleDataCache());
afterEach(() => {
  vi.unstubAllGlobals();
  global.fetch = realFetch;
});

describe("decodeVin", () => {
  it("maps vPIC fields and normalizes 'Not Applicable' to null", async () => {
    stubFetch({
      Results: [
        { ModelYear: "2019", Make: "HONDA", Model: "Civic", Trim: "Not Applicable", BodyClass: "Sedan", DriveType: "FWD", EngineCylinders: "4", FuelTypePrimary: "Gasoline" },
      ],
    });
    const r = await decodeVin("2HGFC2F59KH500000");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.make).toBe("HONDA");
      expect(r.trim).toBeNull();
      expect(r.source).toContain("NHTSA");
      expect(r.fetchedAt).toBeTruthy();
    }
  });

  it("rejects malformed VINs WITHOUT calling the API (fail-closed local)", async () => {
    const fn = stubFetch({});
    const r = await decodeVin("nope!");
    expect(r.ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("caches — second identical call makes no second fetch", async () => {
    const fn = stubFetch({ Results: [{ ModelYear: "2020", Make: "FORD", Model: "F-150" }] });
    await decodeVin("1FTEW1EP5LFA00000");
    await decodeVin("1FTEW1EP5LFA00000");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("API failure returns typed error — never a fake-empty decode", async () => {
    stubFetch({}, false);
    const r = await decodeVin("2HGFC2F59KH500000");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("NHTSA");
  });
});

describe("recallsByVehicle", () => {
  it("maps, caps at 10, and carries the advisor disclaimer", async () => {
    stubFetch({
      Count: 12,
      results: Array.from({ length: 12 }, (_, i) => ({
        NHTSACampaignNumber: `24V${i}`,
        Component: "AIR BAGS",
        Summary: "x".repeat(400),
        ReportReceivedDate: "2024-01-01",
      })),
    });
    const r = await recallsByVehicle({ year: "2019", make: "Honda", model: "Civic" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recallCount).toBe(12);
      expect(r.recalls).toHaveLength(10);
      expect(r.recalls[0].summary?.length).toBeLessThanOrEqual(300);
      expect(r.disclaimer).toContain("not a diagnosis");
    }
  });

  it("validates inputs locally (bad year → no fetch)", async () => {
    const fn = stubFetch({});
    const r = await recallsByVehicle({ year: "19", make: "Honda", model: "Civic" });
    expect(r.ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
