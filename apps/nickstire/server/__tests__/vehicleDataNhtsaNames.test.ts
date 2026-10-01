/**
 * Q-50 phase 2b: NHTSA's names for shop spellings (ADR-0021 §8), NHTSA's 400 for a name it does
 * not know, and the six phase-1 cases the review found untested (dd/mm order, deaths-only,
 * errors not cached, `count` vs row count; the two panel cases live in nhtsa-warranty-panel.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _clearVehicleDataCache, complaintsByVehicle, recallsByVehicle } from "../services/vehicleData";
import { storedMakeSpellings, toNhtsaVehicleName } from "../services/nhtsaVehicleNames";

function stub(...responses: Array<{ status: number; body: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body });
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}
const url = (fn: ReturnType<typeof vi.fn>, i = 0) => String(fn.mock.calls[i]?.[0]);

beforeEach(() => _clearVehicleDataCache());
afterEach(() => vi.unstubAllGlobals());

describe("toNhtsaVehicleName (§8 make aliases)", () => {
  it("maps the shop's spellings NHTSA answers 400 for", () => {
    expect(toNhtsaVehicleName("Chevy", "Silverado")).toEqual({ make: "CHEVROLET", model: "Silverado", aliased: true });
    expect(toNhtsaVehicleName(" vw ", "Jetta")).toEqual({ make: "VOLKSWAGEN", model: "Jetta", aliased: true });
    expect(toNhtsaVehicleName("Mercedes", "C300")).toMatchObject({ make: "MERCEDES-BENZ", aliased: true });
    expect(toNhtsaVehicleName("Mercedes Benz", "C300")).toMatchObject({ make: "MERCEDES-BENZ", aliased: true });
    // workOrderAutomation's second-word split leaves "Land" as the make.
    expect(toNhtsaVehicleName("Land", "Rover Range Rover")).toEqual({ make: "LAND ROVER", model: "Range Rover", aliased: true });
  });

  it("leaves names NHTSA already knows alone, and does not call a same-name spelling an alias", () => {
    expect(toNhtsaVehicleName("Honda", "Accord")).toEqual({ make: "Honda", model: "Accord", aliased: false });
    expect(toNhtsaVehicleName("Mercedes-Benz", "C300")).toMatchObject({ make: "MERCEDES-BENZ", aliased: false });
    expect(toNhtsaVehicleName("Land Rover", "LR4")).toEqual({ make: "LAND ROVER", model: "LR4", aliased: false });
    expect(toNhtsaVehicleName("Land", "Cruiser")).toEqual({ make: "Land", model: "Cruiser", aliased: false });
  });

  it("lists every stored make_norm a make can appear as (the ingest keeps MERCEDES BENZ's space)", () => {
    expect(storedMakeSpellings("MERCEDES-BENZ").sort()).toEqual(["MERCEDES BENZ", "MERCEDESBENZ"]);
    expect(storedMakeSpellings("LAND ROVER").sort()).toEqual(["LAND ROVER", "LANDROVER"]);
    expect(storedMakeSpellings("Chevrolet")).toEqual(["CHEVROLET"]);
  });
});

describe("live lookups ask NHTSA by its own names", () => {
  it("Chevy / Silverado / 2015 resolves to CHEVROLET, and the payload says it was aliased", async () => {
    const fn = stub({ status: 200, body: { Count: 0, results: [] } });
    const r = await recallsByVehicle({ year: "2015", make: "Chevy", model: "Silverado" });
    expect(url(fn)).toContain("make=CHEVROLET&model=Silverado&modelYear=2015");
    expect(r).toMatchObject({ ok: true, make: "CHEVROLET", aliased: true });
  });

  it("Land / Rover Range Rover asks for LAND ROVER Range Rover", async () => {
    const fn = stub({ status: 200, body: { count: 0, results: [] } });
    await complaintsByVehicle({ year: "2016", make: "Land", model: "Rover Range Rover" });
    expect(url(fn)).toContain("make=LAND%20ROVER&model=Range%20Rover&modelYear=2016");
  });
});

describe("NHTSA's 400 for a name it does not know", () => {
  it("is reported as an unknown vehicle, not an outage, and never as 0 recalls", async () => {
    stub({ status: 400, body: { count: 0, results: [] } });
    const r = await recallsByVehicle({ year: "2018", make: "Ford", model: "F150" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unknown_vehicle");
    expect(r.error).toMatch(/NHTSA has no vehicle named "Ford F150" for 2018/);
  });

  it("a 400 with any other body, and a 503, stay plain errors (Retry can help those)", async () => {
    stub({ status: 400, body: { message: "bad request" } }, { status: 503, body: {} });
    const a = await complaintsByVehicle({ year: "2018", make: "Ford", model: "F150" });
    const b = await complaintsByVehicle({ year: "2019", make: "Ford", model: "F150" });
    expect(a).toMatchObject({ ok: false, error: "NHTSA 400" });
    expect(a.ok === false && a.reason).toBeUndefined();
    expect(b).toMatchObject({ ok: false, error: "NHTSA 503" });
  });

  it("errors are not cached: the next open asks again and can succeed", async () => {
    const fn = stub({ status: 503, body: {} }, { status: 200, body: { count: 2, results: [{}, {}] } });
    expect((await complaintsByVehicle({ year: "2012", make: "Ford", model: "Focus" })).ok).toBe(false);
    const second = await complaintsByVehicle({ year: "2012", make: "Ford", model: "Focus" });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ ok: true, complaintCount: 2 });
  });
});

describe("phase 1 cases the review found untested", () => {
  it("reads 04/05/2023 as 4 May (dd/mm), so it sorts after 10 April", async () => {
    // As mm/dd these would be 5 April and 5 October: the order flips.
    stub({
      status: 200,
      body: { Count: 2, results: [
        { NHTSACampaignNumber: "APR", ReportReceivedDate: "10/04/2023" },
        { NHTSACampaignNumber: "MAY", ReportReceivedDate: "04/05/2023" },
      ] },
    });
    const r = await recallsByVehicle({ year: "2020", make: "Honda", model: "Civic" });
    expect(r.ok && r.recalls.map((x) => x.campaign)).toEqual(["MAY", "APR"]);
  });

  it("counts a complaint reporting only deaths as an injury complaint", async () => {
    stub({ status: 200, body: { count: 1, results: [{ numberOfInjuries: 0, numberOfDeaths: 1 }] } });
    const c = await complaintsByVehicle({ year: "2020", make: "Honda", model: "Civic" });
    expect(c).toMatchObject({ ok: true, injuryCount: 1 });
  });

  it("gives the first, uncached complaint lookup longer than recalls get (11.8 s was measured live)", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      stub({ status: 200, body: { Count: 0, results: [] } }, { status: 200, body: { count: 0, results: [] } });
      await recallsByVehicle({ year: "2012", make: "Ford", model: "Focus" });
      await complaintsByVehicle({ year: "2012", make: "Ford", model: "Focus" });
      expect(timeout.mock.calls.map((c) => c[0])).toEqual([10_000, 25_000]);
    } finally {
      timeout.mockRestore();
    }
  });

  it("takes the complaint total from NHTSA's count, not the rows returned", async () => {
    stub({ status: 200, body: { count: 1882, results: [{}, {}] } });
    const c = await complaintsByVehicle({ year: "2018", make: "Honda", model: "Accord" });
    expect(c).toMatchObject({ ok: true, complaintCount: 1882 });
  });
});
