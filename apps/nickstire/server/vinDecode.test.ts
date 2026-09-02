import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeVin, mergeDecoded, normalizeVin, __clearVinCache } from "./services/vinDecode";

const okResponse = (results: Record<string, string>) => ({
  ok: true,
  status: 200,
  json: async () => ({ Results: [results] }),
}) as unknown as Response;

describe("vinDecode (NHTSA vPIC)", () => {
  beforeEach(() => __clearVinCache());

  it("normalizes and rejects malformed VINs without a network call", async () => {
    expect(normalizeVin(" 1hgcm82633a004352 ")).toBe("1HGCM82633A004352");
    expect(normalizeVin("1HGCM82633A00435O")).toBeNull(); // letter O is illegal
    expect(normalizeVin("short")).toBeNull();
    const fetchSpy = vi.fn();
    expect(await decodeVin("nope", fetchSpy as unknown as typeof fetch)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns year/make/model from a clean decode and caches it", async () => {
    const fetchSpy = vi.fn(async () => okResponse({ ErrorCode: "0", ModelYear: "2003", Make: "HONDA", Model: "Accord" }));
    const r1 = await decodeVin("1HGCM82633A004352", fetchSpy as unknown as typeof fetch);
    expect(r1).toMatchObject({ year: "2003", make: "Honda", model: "Accord", source: "vpic", vpicError: null });
    const r2 = await decodeVin("1HGCM82633A004352", fetchSpy as unknown as typeof fetch);
    expect(r2).toEqual(r1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not trust fields when vPIC reports a hard VIN error", async () => {
    const fetchSpy = vi.fn(async () => okResponse({ ErrorCode: "1", ErrorText: "1 - Check Digit (9th position) does not calculate properly", ModelYear: "2003", Make: "HONDA" }));
    const r = await decodeVin("1HGCM82633A004352", fetchSpy as unknown as typeof fetch);
    expect(r).toMatchObject({ year: null, make: null, model: null });
    expect(r?.vpicError).toMatch(/Check Digit/);
  });

  it("never throws: network failure returns null and is not cached", async () => {
    const failing = vi.fn(async () => { throw new Error("offline"); });
    expect(await decodeVin("1HGCM82633A004352", failing as unknown as typeof fetch)).toBeNull();
    const ok = vi.fn(async () => okResponse({ ErrorCode: "0", ModelYear: "2003", Make: "HONDA", Model: "Accord" }));
    expect(await decodeVin("1HGCM82633A004352", ok as unknown as typeof fetch)).toMatchObject({ make: "Honda" });
  });

  it("mergeDecoded fills ONLY empty fields — human input always wins", () => {
    const decoded = { vin: "X", year: "2003", make: "Honda", model: "Accord", source: "vpic" as const, vpicError: null };
    expect(mergeDecoded({ year: "2004", make: "", model: null }, decoded)).toMatchObject({ year: "2004", make: "Honda", model: "Accord", vinDecodedFrom: "vpic" });
    expect(mergeDecoded({ year: "2004", make: "Toyota", model: "Camry" }, decoded)).toEqual({ year: "2004", make: "Toyota", model: "Camry" });
    expect(mergeDecoded({ year: null, make: null, model: null }, null)).toEqual({ year: null, make: null, model: null });
  });
});
