import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _clearVehicleDataCache,
  complaintsByVehicle,
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

  it("preserves the admin route's historical partial-VIN lookup contract", async () => {
    const fn = stubFetch({
      Results: [{ ErrorCode: "0", ModelYear: "2003", Make: "HONDA", Model: "Accord" }],
    });
    const result = await decodeVin("1HGCM82633A");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vin).toBe("1HGCM82633A");
      expect(result.make).toBe("HONDA");
      expect(result.model).toBe("Accord");
    }
    expect(fn).toHaveBeenCalledTimes(1);
    expect(String(fn.mock.calls[0]?.[0])).toContain("DecodeVinValues/1HGCM82633A");
  });

  it("still rejects malformed VINs locally without a request", async () => {
    const fn = stubFetch({});
    expect((await decodeVin("nope!")).ok).toBe(false);
    expect((await decodeVin("1HGCM82633IO")).ok).toBe(false);
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

describe("recallsByVehicle — Q-50 panel fields", () => {
  it("orders newest first from NHTSA's dd/mm/yyyy dates and carries park-it flags + remedy", async () => {
    stubFetch({
      Count: 3,
      results: [
        { NHTSACampaignNumber: "18V001000", ReportReceivedDate: "05/01/2018", Remedy: "old fix" },
        { NHTSACampaignNumber: "23V002000", ReportReceivedDate: "28/05/2023", parkIt: true, Remedy: "r".repeat(400) },
        { NHTSACampaignNumber: "20V003000", ReportReceivedDate: "01/12/2020", parkOutSide: true },
      ],
    });
    const result = await recallsByVehicle({ year: "2018", make: "Honda", model: "Accord" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recalls.map((r) => r.campaign)).toEqual(["23V002000", "20V003000", "18V001000"]);
    expect(result.recalls[0]).toMatchObject({ parkIt: true, parkOutside: false });
    expect(result.recalls[0].remedy?.length).toBe(300);
    expect(result.recalls[1]).toMatchObject({ parkIt: false, parkOutside: true, remedy: null });
  });
});

describe("complaintsByVehicle", () => {
  it("returns counts only — no narratives, no VIN fragments — with the advisor disclaimer", async () => {
    const fn = stubFetch({
      count: 4,
      results: [
        { components: "ENGINE,FUEL/PROPULSION SYSTEM", crash: false, fire: false, numberOfInjuries: 0, numberOfDeaths: 0, summary: "my name is Pat, call 216-555-0100", vin: "1HGCV3F4XJA" },
        { components: "ENGINE", crash: true, fire: false, numberOfInjuries: 1, numberOfDeaths: 0, summary: "s" },
        { components: "ELECTRICAL SYSTEM, ENGINE ,ENGINE", crash: false, fire: true, numberOfInjuries: 0, numberOfDeaths: 0 },
        { components: "", crash: false, fire: false },
      ],
    });
    const result = await complaintsByVehicle({ year: "2018", make: "Honda", model: "Accord" });
    expect(String(fn.mock.calls[0]?.[0])).toBe(
      "https://api.nhtsa.gov/complaints/complaintsByVehicle?make=Honda&model=Accord&modelYear=2018",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({ complaintCount: 4, crashCount: 1, fireCount: 1, injuryCount: 1 });
    // A complaint naming ENGINE twice counts once.
    expect(result.topComponents[0]).toEqual({ component: "ENGINE", count: 3 });
    expect(result.topComponents).toContainEqual({ component: "ELECTRICAL SYSTEM", count: 1 });
    expect(result.disclaimer).toMatch(/not a diagnosis/);
    const wire = JSON.stringify(result);
    expect(wire).not.toContain("216-555-0100");
    expect(wire).not.toContain("1HGCV3F4XJA");
  });

  it("an upstream failure is a typed error, never a confident zero", async () => {
    stubFetch({}, false);
    const result = await complaintsByVehicle({ year: "2018", make: "Honda", model: "Accord" });
    expect(result.ok).toBe(false);
  });

  it("a 200 without a results array is an error, not 0 complaints", async () => {
    stubFetch({ count: 0, message: "unexpected" });
    const result = await complaintsByVehicle({ year: "2018", make: "Honda", model: "Accord" });
    expect(result.ok).toBe(false);
  });

  it("validates locally and caches per vehicle", async () => {
    const fn = stubFetch({ count: 0, results: [] });
    expect((await complaintsByVehicle({ year: "18", make: "Honda", model: "Accord" })).ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    await complaintsByVehicle({ year: "2018", make: "Honda", model: "Accord" });
    await complaintsByVehicle({ year: "2018", make: "HONDA", model: "accord" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("recallsByVehicle — empty vs error (Q-50)", () => {
  it("a 200 without a results array is an error, not 0 recalls", async () => {
    stubFetch({ Count: 0, Message: "unexpected" });
    const result = await recallsByVehicle({ year: "2018", make: "Honda", model: "Accord" });
    expect(result.ok).toBe(false);
  });

  it("a real empty result still reads as 0 recalls", async () => {
    stubFetch({ Count: 0, Message: "Results returned successfully", results: [] });
    const result = await recallsByVehicle({ year: "2018", make: "Honda", model: "Accord" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recallCount).toBe(0);
  });
});
