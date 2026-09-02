import { describe, it, expect, vi } from "vitest";
import { decodeVin, mergeDecoded } from "./services/vinDecode";

const okResponse = (results: Record<string, string>) => ({
  ok: true,
  status: 200,
  json: async () => ({ Results: [results] }),
}) as unknown as Response;

// Each case uses its own valid VIN so the per-process cache cannot leak between them.
const VIN_A = "1HGCM82633A004352";
const VIN_B = "1FTFW1ET5EKE12345";
const VIN_C = "JH4KA7532NC000123";

describe("vinDecode (NHTSA vPIC)", () => {
  it("rejects malformed VINs without a network call (17 chars, no I/O/Q)", async () => {
    const fetchSpy = vi.fn();
    expect(await decodeVin("1HGCM82633A00435O", fetchSpy as unknown as typeof fetch)).toBeNull(); // letter O is illegal
    expect(await decodeVin("short", fetchSpy as unknown as typeof fetch)).toBeNull();
    expect(await decodeVin(null, fetchSpy as unknown as typeof fetch)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normalizes case/whitespace, returns year/make/model from a clean decode, and caches it", async () => {
    const fetchSpy = vi.fn(async () => okResponse({ ErrorCode: "0", ModelYear: "2003", Make: "HONDA", Model: "Accord" }));
    const r1 = await decodeVin(` ${VIN_A.toLowerCase()} `, fetchSpy as unknown as typeof fetch);
    expect(r1).toMatchObject({ vin: VIN_A, year: "2003", make: "Honda", model: "Accord", source: "vpic", vpicError: null });
    const r2 = await decodeVin(VIN_A, fetchSpy as unknown as typeof fetch);
    expect(r2).toEqual(r1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not trust fields when vPIC reports a hard VIN error", async () => {
    const fetchSpy = vi.fn(async () => okResponse({ ErrorCode: "1", ErrorText: "1 - Check Digit (9th position) does not calculate properly", ModelYear: "2003", Make: "HONDA" }));
    const r = await decodeVin(VIN_B, fetchSpy as unknown as typeof fetch);
    expect(r).toMatchObject({ year: null, make: null, model: null });
    expect(r?.vpicError).toMatch(/Check Digit/);
  });

  it("never throws: a network failure returns null and is not cached, so a later call can succeed", async () => {
    const failing = vi.fn(async () => { throw new Error("offline"); });
    expect(await decodeVin(VIN_C, failing as unknown as typeof fetch)).toBeNull();
    const ok = vi.fn(async () => okResponse({ ErrorCode: "0", ModelYear: "1992", Make: "ACURA", Model: "Legend" }));
    expect(await decodeVin(VIN_C, ok as unknown as typeof fetch)).toMatchObject({ make: "Acura", model: "Legend" });
  });

  it("mergeDecoded fills ONLY empty fields — human input always wins", () => {
    const decoded = { vin: "X", year: "2003", make: "Honda", model: "Accord", source: "vpic" as const, vpicError: null };
    expect(mergeDecoded({ year: "2004", make: "", model: null }, decoded)).toMatchObject({ year: "2004", make: "Honda", model: "Accord", vinDecodedFrom: "vpic" });
    expect(mergeDecoded({ year: "2004", make: "Toyota", model: "Camry" }, decoded)).toEqual({ year: "2004", make: "Toyota", model: "Camry" });
    expect(mergeDecoded({ year: null, make: null, model: null }, null)).toEqual({ year: null, make: null, model: null });
  });
});
