/**
 * realAssetFirst — §K.3 retrieval.
 *
 * The scorer is pure and pinned directly. findRealAssetFor is pinned through
 * the REAL pool reader seam (instagramAdminStrategy.listReusableRealShopMedia
 * mocked at the module boundary) so the three honest outcomes — matched,
 * no_match, ERROR — are each asserted as distinct states. The error case is
 * the empty-vs-error canary: a rejected pool read must never surface as
 * "no assets".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../db";

const { listReusableRealShopMedia } = vi.hoisted(() => ({ listReusableRealShopMedia: vi.fn() }));
vi.mock("./instagramAdminStrategy", () => ({ listReusableRealShopMedia }));

import {
  assertServiceKeywordsAreRoutes,
  findRealAssetFor,
  inferRealAssetNeed,
  REAL_ASSET_MIN_SCORE,
  scoreRealAsset,
  toRealAssetRef,
} from "./realAssetFirst";
import type { MediaEnrichment } from "./mediaEnrichment";

const fakeDb = {} as unknown as DB;
const stamp = { provider: "gemini", model: "test", at: "2026-10-01T00:00:00.000Z" };
const rotor: MediaEnrichment = { ...stamp, subject: "rotor", service: "/brakes", symptoms: ["grinding", "pulsating pedal"], failureMode: "rotor scored past minimum", quality: 0.8 };
const tire: MediaEnrichment = { ...stamp, subject: "tire", service: "/used-tires-cleveland", symptoms: ["low tread"], quality: 0.9 };
const battery: MediaEnrichment = { ...stamp, subject: "battery", service: "/battery", symptoms: ["no start"], quality: 0.9 };

const row = (id: string, enrichment: MediaEnrichment | null, mimeType = "image/jpeg") => ({
  id, logicalKey: id, url: `https://cdn.example/${id}.jpg`, mimeType, width: 1080, height: 1350, createdAt: new Date(), originalFilename: null, enrichment,
});

afterEach(() => { listReusableRealShopMedia.mockReset(); });

describe("inferRealAssetNeed — keyword map", () => {
  it("'grinding brakes' wants the brake wear parts (pad + rotor, graph edge order) for /brakes", () => {
    const need = inferRealAssetNeed({ topic: "grinding brakes on a Cleveland winter commute" });
    // topicGraph: symptom:grinding → part:pads, part:rotors (pads first — the mechanic's order).
    expect(need.subjects.slice(0, 2)).toEqual(["pad", "rotor"]);
    expect(need.subjects).not.toContain("tire");
    expect(need.service).toBe("/brakes");
  });
  it("a phrase the graph has no claim on still resolves through the keyword map", () => {
    const need = inferRealAssetNeed({ topic: "serpentine belt cracked at the ribs" });
    expect(need.subjects[0]).toBe("belt");
    expect(need.service).toBe("/belts-hoses");
  });
  it("a hint wins the primary slot over both graph and map", () => {
    expect(inferRealAssetNeed({ topic: "grinding brakes", subjectHints: ["printout"] }).subjects[0]).toBe("printout");
  });
  it("a caller-supplied canonical service wins over inference; a non-route is ignored", () => {
    expect(inferRealAssetNeed({ topic: "grinding brakes", service: "/battery" }).service).toBe("/battery");
    expect(inferRealAssetNeed({ topic: "grinding brakes", service: "/not-a-route" }).service).toBe("/brakes");
  });
  it("every SERVICE_KEYWORDS key is a real service route in shared/routes.ts", () => {
    expect(assertServiceKeywordsAreRoutes()).toEqual([]);
  });
});

describe("scoreRealAsset — POSITIVE CONTROL: rotor beats tire for 'grinding brakes'", () => {
  const need = inferRealAssetNeed({ topic: "grinding brakes" });
  it("rotor asset clears the threshold with subject + service + symptom reasons", () => {
    const r = scoreRealAsset(need, rotor);
    expect(r.score).toBeGreaterThanOrEqual(REAL_ASSET_MIN_SCORE);
    expect(r.why.join(" ")).toMatch(/subject rotor matches/);
    expect(r.why.join(" ")).toMatch(/service \/brakes matches/);
    expect(r.why.join(" ")).toMatch(/symptom overlap: grinding/);
  });
  it("tire asset scores 0 — wrong subject is disqualifying, not merely weaker", () => {
    const t = scoreRealAsset(need, tire);
    expect(t.score).toBe(0);
    expect(t.why[0]).toMatch(/subject tire is not one of pad\/rotor/);
    expect(scoreRealAsset(need, rotor).score).toBeGreaterThan(t.score);
  });
  it("quality below the floor zeroes an otherwise perfect match", () => {
    expect(scoreRealAsset(need, { ...rotor, quality: 0.1 })).toMatchObject({ score: 0 });
  });
  it("an unknown quality is reported, not assumed", () => {
    const { quality: _q, ...noQuality } = rotor;
    expect(scoreRealAsset(need, noQuality).why).toContain("quality unknown — not scaled");
  });
});

describe("findRealAssetFor — three outcomes, never collapsed", () => {
  it("matched: picks the rotor over the tire and reports why", async () => {
    listReusableRealShopMedia.mockResolvedValue([row("ma_tire", tire), row("ma_rotor", rotor)]);
    const r = await findRealAssetFor({ topic: "grinding brakes" }, { database: fakeDb });
    expect(r.state).toBe("matched");
    expect(r.match?.assetId).toBe("ma_rotor");
    expect(r.why.join(" ")).toMatch(/score .* ≥ 0\.6/);
    const ref = toRealAssetRef(r.match!);
    expect(ref).toMatchObject({ assetId: "ma_rotor", url: "https://cdn.example/ma_rotor.jpg", enrichment: { subject: "rotor", service: "/brakes" } });
  });
  it("no_match: below-threshold pool yields null with the best loser named", async () => {
    listReusableRealShopMedia.mockResolvedValue([row("ma_battery", battery)]);
    const r = await findRealAssetFor({ topic: "grinding brakes" }, { database: fakeDb });
    expect(r).toMatchObject({ state: "no_match", match: null });
    expect(r.why.join(" ")).toMatch(/1 enriched asset\(s\) scored/);
  });
  it("pool_unenriched: rows exist but none carries an enrichment — reported as such", async () => {
    listReusableRealShopMedia.mockResolvedValue([row("ma_raw", null)]);
    const r = await findRealAssetFor({ topic: "grinding brakes" }, { database: fakeDb });
    expect(r.state).toBe("pool_unenriched");
    expect(r.why.join(" ")).toMatch(/1 real_shop image\(s\) exist but none is enriched/);
  });
  it("pool_empty when the reader returns nothing", async () => {
    listReusableRealShopMedia.mockResolvedValue([]);
    expect((await findRealAssetFor({ topic: "grinding brakes" }, { database: fakeDb })).state).toBe("pool_empty");
  });
  it("EMPTY-VS-ERROR CANARY: a failed pool read is state=error with the message, never 'no assets'", async () => {
    listReusableRealShopMedia.mockRejectedValue(new Error("ECONNRESET: TiDB gateway"));
    const r = await findRealAssetFor({ topic: "grinding brakes" }, { database: fakeDb });
    expect(r.state).toBe("error");
    expect(r.match).toBeNull();
    expect("error" in r && r.error).toMatch(/ECONNRESET/);
  });
  it("a topic naming no subject or service short-circuits without reading the pool", async () => {
    const r = await findRealAssetFor({ topic: "hello from the shop" }, { database: fakeDb });
    expect(r.state).toBe("no_match");
    expect(listReusableRealShopMedia).not.toHaveBeenCalled();
  });
});
