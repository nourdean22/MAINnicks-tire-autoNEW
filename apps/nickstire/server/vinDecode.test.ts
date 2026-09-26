import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _clearVinDecodeCache,
  decodeVin,
  decodeVinBatch,
  mergeDecoded,
} from "./services/vinDecode";

const response = (results: Array<Record<string, string>>, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => ({ Results: results }),
}) as unknown as Response;

const VIN_A = "1HGCM82633A004352";
const VIN_B = "1FTFW1ET5EKE12345";
const VIN_C = "JH4KA7532NC000123";

beforeEach(() => _clearVinDecodeCache());

describe("vinDecode canonical NHTSA path", () => {
  it("rejects malformed VINs without a network call", async () => {
    const fetchSpy = vi.fn();
    expect(await decodeVin("1HGCM82633A00435O", fetchSpy as unknown as typeof fetch)).toBeNull();
    expect(await decodeVin("short", fetchSpy as unknown as typeof fetch)).toBeNull();
    expect(await decodeVin(null, fetchSpy as unknown as typeof fetch)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps the richer vPIC payload once and caches it", async () => {
    const fetchSpy = vi.fn(async () => response([{
      ErrorCode: "0",
      ModelYear: "2003",
      Make: "HONDA",
      Model: "Accord",
      Trim: "Not Applicable",
      BodyClass: "Sedan",
      DriveType: "FWD",
      EngineCylinders: "4",
      FuelTypePrimary: "Gasoline",
    }]));
    const first = await decodeVin(" " + VIN_A.toLowerCase() + " ", fetchSpy as unknown as typeof fetch);
    expect(first).toMatchObject({
      vin: VIN_A,
      year: "2003",
      make: "Honda",
      model: "Accord",
      trim: null,
      bodyClass: "Sedan",
      driveType: "FWD",
      engineCylinders: "4",
      fuelType: "Gasoline",
      source: "vpic",
      vpicError: null,
    });
    expect(first?.fetchedAt).toBeTruthy();
    expect(await decodeVin(VIN_A, fetchSpy as unknown as typeof fetch)).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not trust decode fields when vPIC reports a hard VIN error", async () => {
    const fetchSpy = vi.fn(async () => response([{
      ErrorCode: "1",
      ErrorText: "1 - Check Digit does not calculate properly",
      ModelYear: "2003",
      Make: "HONDA",
    }]));
    const result = await decodeVin(VIN_B, fetchSpy as unknown as typeof fetch);
    expect(result).toMatchObject({
      year: null,
      make: null,
      model: null,
      trim: null,
      bodyClass: null,
    });
    expect(result?.vpicError).toMatch(/Check Digit/);
  });

  it("never caches transient single-decode failures", async () => {
    const failing = vi.fn(async () => { throw new Error("offline"); });
    expect(await decodeVin(VIN_C, failing as unknown as typeof fetch)).toBeNull();

    const succeeding = vi.fn(async () => response([{
      ErrorCode: "0",
      ModelYear: "1992",
      Make: "ACURA",
      Model: "Legend",
    }]));
    expect(await decodeVin(VIN_C, succeeding as unknown as typeof fetch)).toMatchObject({
      make: "Acura",
      model: "Legend",
    });
  });

  it("fills only empty year/make/model fields", () => {
    const decoded = {
      vin: VIN_A,
      year: "2003",
      make: "Honda",
      model: "Accord",
      trim: null,
      bodyClass: null,
      driveType: null,
      engineCylinders: null,
      fuelType: null,
      source: "vpic" as const,
      fetchedAt: "2026-09-26T00:00:00.000Z",
      vpicError: null,
    };
    expect(mergeDecoded({ year: "2004", make: "", model: null }, decoded)).toMatchObject({
      year: "2004",
      make: "Honda",
      model: "Accord",
      vinDecodedFrom: "vpic",
    });
    expect(mergeDecoded({ year: "2004", make: "Toyota", model: "Camry" }, decoded)).toEqual({
      year: "2004",
      make: "Toyota",
      model: "Camry",
    });
  });

  it("uses the official batch endpoint in chunks of at most 50 and preserves order", async () => {
    const inputs = Array.from({ length: 51 }, (_, index) => ({
      vin: "1HGCM82633A" + String(index).padStart(6, "0"),
      modelYear: index % 2 === 0 ? "2020" : null,
    }));
    const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("DecodeVINValuesBatch");
      expect(init?.method).toBe("POST");
      const params = new URLSearchParams(String(init?.body ?? ""));
      expect(params.get("format")).toBe("json");
      const rows = String(params.get("data") ?? "").split(";").filter(Boolean).map((entry) => {
        const [vin, modelYear] = entry.split(",");
        return {
          VIN: vin,
          ErrorCode: "0",
          ModelYear: modelYear || "2021",
          Make: "FORD",
          Model: "F-150",
        };
      });
      return response(rows);
    });

    const result = await decodeVinBatch(inputs, fetchSpy as unknown as typeof fetch);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstBody = new URLSearchParams(String(fetchSpy.mock.calls[0]?.[1]?.body ?? ""));
    const secondBody = new URLSearchParams(String(fetchSpy.mock.calls[1]?.[1]?.body ?? ""));
    expect(String(firstBody.get("data") ?? "").split(";")).toHaveLength(50);
    expect(String(secondBody.get("data") ?? "").split(";")).toHaveLength(1);
    expect(result).toHaveLength(51);
    result.forEach((entry, index) => {
      expect(entry.input).toEqual(inputs[index]);
      expect(entry.decoded?.vin).toBe(inputs[index].vin);
    });
  });

  it("keeps invalid batch inputs in place but never sends them", async () => {
    const fetchSpy = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body ?? ""));
      const sent = String(params.get("data") ?? "").split(";").filter(Boolean);
      expect(sent).toHaveLength(2);
      return response(sent.map((entry) => ({
        VIN: entry.split(",")[0],
        ErrorCode: "0",
        ModelYear: "2020",
        Make: "HONDA",
        Model: "Civic",
      })));
    });
    const inputs = [{ vin: VIN_A }, { vin: "bad" }, { vin: VIN_B, modelYear: 2020 }];
    const result = await decodeVinBatch(inputs, fetchSpy as unknown as typeof fetch);
    expect(result[0].decoded?.vin).toBe(VIN_A);
    expect(result[1].decoded).toBeNull();
    expect(result[2].decoded?.vin).toBe(VIN_B);
  });

  it("returns nulls instead of throwing when a batch chunk is unavailable", async () => {
    const fetchSpy = vi.fn(async () => response([], false, 503));
    const result = await decodeVinBatch([{ vin: VIN_A }, { vin: VIN_B }], fetchSpy as unknown as typeof fetch);
    expect(result.map((entry) => entry.decoded)).toEqual([null, null]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps vehicleData as an adapter instead of a second vPIC decoder", () => {
    const source = readFileSync(new URL("./services/vehicleData.ts", import.meta.url), "utf8");
    expect(source).toContain('from "./vinDecode"');
    expect(source).not.toContain("DecodeVinValues");
    expect(source).not.toContain("DecodeVINValuesBatch");
  });
});
