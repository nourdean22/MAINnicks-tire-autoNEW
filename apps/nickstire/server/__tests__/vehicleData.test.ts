import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _clearVehicleDataCache,
  decodeVin,
  recallsByVehicle,
} from "../services/vehicleData";

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

describe("vehicleData VIN compatibility adapter", () => {
  it("preserves the admin payload while canonical vinDecode owns the HTTP request", async () => {
    stubFetch({
      Results: [{
        ErrorCode: "0",
        ModelYear: "2019",
        Make: "HONDA",
        Model: "Civic",
        Trim: "Not Applicable",
        BodyClass: "Sedan",
        DriveType: "FWD",
        EngineCylinders: "4",
        FuelTypePrimary: "Gasoline",
      }],
    });
    const result = await decodeVin("2HGFC2F59KH500000");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result).toMatchObject({
        make: "HONDA",
        model: "Civic",
        trim: null,
        bodyClass: "Sedan",
        driveType: "FWD",
        engineCylinders: "4",
        fuelType: "Gasoline",
      });
      expect(result.source).toContain("NHTSA");
      expect(result.fetchedAt).toBeTruthy();
    }
  });

  it("rejects partial or malformed VINs locally without a request", async () => {
    const fn = stubFetch({});
    expect((await decodeVin("nope!")).ok).toBe(false);
    expect((await decodeVin("1HGCM82633A")).ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("shares the canonical VIN cache across repeated admin calls", async () => {
    const fn = stubFetch({
      Results: [{ ErrorCode: "0", ModelYear: "2020", Make: "FORD", Model: "F-150" }],
    });
    await decodeVin("1FTEW1EP5LFA00000");
    await decodeVin("1FTEW1EP5LFA00000");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("turns an upstream failure into a typed error instead of fake-empty data", async () => {
    stubFetch({}, false);
    const result = await decodeVin("2HGFC2F59KH500000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("NHTSA");
  });
});

describe("recallsByVehicle", () => {
  it("maps, caps at 10, and carries the advisor disclaimer", async () => {
    stubFetch({
      Count: 12,
      results: Array.from({ length: 12 }, (_, index) => ({
        NHTSACampaignNumber: "24V" + index,
        Component: "AIR BAGS",
        Summary: "x".repeat(400),
        ReportReceivedDate: "2024-01-01",
      })),
    });
    const result = await recallsByVehicle({ year: "2019", make: "Honda", model: "Civic" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recallCount).toBe(12);
      expect(result.recalls).toHaveLength(10);
      expect(result.recalls[0].summary?.length).toBeLessThanOrEqual(300);
      expect(result.disclaimer).toContain("not a diagnosis");
    }
  });

  it("validates recall inputs locally", async () => {
    const fn = stubFetch({});
    const result = await recallsByVehicle({ year: "19", make: "Honda", model: "Civic" });
    expect(result.ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
