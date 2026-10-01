/**
 * listReusableRealShopMedia — §K.2 registry filters.
 *
 * Filters run in JS over the 100-row window (see the function comment for
 * why). What is pinned: each filter's semantics, that an UNENRICHED row never
 * satisfies a filter, that no filter returns every row with its enrichment
 * (null for unenriched), and that a DB rejection PROPAGATES — the picker and
 * realAssetFirst both rely on that to tell "error" from "empty".
 */
import { describe, expect, it } from "vitest";
import type { DB } from "../db";
import { listReusableRealShopMedia } from "./instagramAdminStrategy";

const stamp = { provider: "gemini", model: "m", at: "2026-10-01T00:00:00.000Z" };
const row = (id: string, enrichment: Record<string, unknown> | null) => ({
  id, logicalKey: id, runtimeUrl: `https://cdn.example/${id}.jpg`, driveUrl: null, mimeType: "image/jpeg", width: 1080, height: 1350,
  createdAt: new Date(), generationParamsJson: JSON.stringify({ originalFilename: `${id}.jpg`, ...(enrichment ? { enrichment: { ...stamp, ...enrichment } } : {}) }),
});
const ROWS = [
  row("rotor_fall", { subject: "rotor", service: "/brakes", symptoms: ["grinding"], failureMode: "scored rotor", season: "fall", quality: 0.8 }),
  row("tire_winter", { subject: "tire", service: "/used-tires-cleveland", symptoms: ["low tread"], season: "winter", quality: 0.5 }),
  row("rotor_noq", { subject: "rotor", service: "/brakes", season: "fall" }),
  row("raw", null),
  { ...row("no_url", { subject: "pad" }), runtimeUrl: null },
];

function dbReturning(rows: typeof ROWS) {
  return {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => rows }) }) }) }),
  } as unknown as DB;
}
function dbRejecting(err: Error) {
  return {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => { throw err; } }) }) }) }),
  } as unknown as DB;
}

describe("listReusableRealShopMedia", () => {
  it("no filter: every row with a runtime url, enrichment attached or null", async () => {
    const out = await listReusableRealShopMedia(dbReturning(ROWS));
    expect(out.map((r) => r.id)).toEqual(["rotor_fall", "tire_winter", "rotor_noq", "raw"]);
    expect(out[0].enrichment).toMatchObject({ subject: "rotor", service: "/brakes" });
    expect(out[3].enrichment).toBeNull();
  });

  it("subject filter — case-insensitive; an unenriched row never matches", async () => {
    const out = await listReusableRealShopMedia(dbReturning(ROWS), { subject: "Rotor" });
    expect(out.map((r) => r.id)).toEqual(["rotor_fall", "rotor_noq"]);
  });

  it("service + season filters are exact on the canonical values", async () => {
    expect((await listReusableRealShopMedia(dbReturning(ROWS), { service: "/brakes", season: "fall" })).map((r) => r.id)).toEqual(["rotor_fall", "rotor_noq"]);
    expect((await listReusableRealShopMedia(dbReturning(ROWS), { service: "/brakes", season: "winter" })).map((r) => r.id)).toEqual([]);
  });

  it("symptom filter is a substring over symptoms + failureMode", async () => {
    expect((await listReusableRealShopMedia(dbReturning(ROWS), { symptom: "grind" })).map((r) => r.id)).toEqual(["rotor_fall"]);
    expect((await listReusableRealShopMedia(dbReturning(ROWS), { symptom: "scored" })).map((r) => r.id)).toEqual(["rotor_fall"]);
  });

  it("minQuality EXCLUDES rows whose quality is unknown — unknown is not 'good enough'", async () => {
    expect((await listReusableRealShopMedia(dbReturning(ROWS), { minQuality: 0.6 })).map((r) => r.id)).toEqual(["rotor_fall"]);
    expect((await listReusableRealShopMedia(dbReturning(ROWS), { minQuality: 0.5 })).map((r) => r.id)).toEqual(["rotor_fall", "tire_winter"]);
  });

  it("EMPTY-VS-ERROR CANARY: a DB failure rejects — it is never an empty list", async () => {
    await expect(listReusableRealShopMedia(dbRejecting(new Error("ETIMEDOUT")))).rejects.toThrow("ETIMEDOUT");
  });
});
