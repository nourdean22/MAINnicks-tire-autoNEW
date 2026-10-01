/**
 * mediaEnrichment — §K.1 vision enrichment of real-shop uploads.
 *
 * The parser is the contract every downstream reader scores against, so it
 * is pinned for the three ways a model reply lies: garbage (null), partial
 * (only present fields), and plausible-but-invalid (a service path that is
 * not a route, a "safe claim" that quotes a price). The persist path is
 * pinned through a fake DB so the merge-not-overwrite rule on
 * generation_params_json is asserted, not hoped.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../db";

const { analyzePhoto } = vi.hoisted(() => ({ analyzePhoto: vi.fn() }));
vi.mock("./vision-analyzer", () => ({ analyzePhoto }));

import { enrichRealShopAsset, parseEnrichmentReply, readEnrichment, seasonFor, serviceRoutePaths } from "./mediaEnrichment";
import { ALL_ROUTES } from "../../shared/routes";

describe("parseEnrichmentReply", () => {
  it("POSITIVE CONTROL: garbage → null, not an empty-but-valid enrichment", () => {
    expect(parseEnrichmentReply("I cannot see the image.")).toBeNull();
    expect(parseEnrichmentReply("")).toBeNull();
    expect(parseEnrichmentReply(null)).toBeNull();
    expect(parseEnrichmentReply("[1,2,3]")).toBeNull();
    expect(parseEnrichmentReply("{not json")).toBeNull();
  });

  it("partial JSON keeps only the fields present — nothing is invented", () => {
    const out = parseEnrichmentReply('```json\n{"subject":"rotor","quality":0.72}\n```');
    expect(out).toEqual({ subject: "rotor", quality: 0.72 });
    expect(out).not.toHaveProperty("service");
    expect(out).not.toHaveProperty("symptoms");
  });

  it("service must be a route in ALL_ROUTES (group service); anything else is dropped", () => {
    expect(parseEnrichmentReply('{"service":"/brakes"}')).toEqual({ service: "/brakes" });
    expect(parseEnrichmentReply('{"service":"brakes"}')).toEqual({ service: "/brakes" });
    expect(parseEnrichmentReply('{"service":"/brake-repair-cleveland-best"}')).toEqual({});
    expect(parseEnrichmentReply('{"service":"/about"}')).toEqual({});
    for (const p of serviceRoutePaths()) {
      expect(ALL_ROUTES.find((r) => r.path === p)?.group).toBe("service");
    }
  });

  it("unknown subject / orientation / opportunity values are omitted, never coerced", () => {
    const out = parseEnrichmentReply('{"subject":"caliper","orientation":"wide","contentOpportunities":["reel","tiktok","reel"]}');
    expect(out).toEqual({ contentOpportunities: ["reel"] });
  });

  it("safeClaims drop prices, guarantees and timelines; observable facts survive", () => {
    const out = parseEnrichmentReply(JSON.stringify({
      safeClaims: ["Rotor face shows heat discoloration", "Brake job from $99", "We guarantee it", "Done in 30 minutes", "Pad is worn to the backing plate"],
    }));
    expect(out?.safeClaims).toEqual(["Rotor face shows heat discoloration", "Pad is worn to the backing plate"]);
  });

  it("quality is clamped to 0..1 and non-numeric quality is omitted", () => {
    expect(parseEnrichmentReply('{"quality":7}')).toEqual({ quality: 1 });
    expect(parseEnrichmentReply('{"quality":"high"}')).toEqual({});
  });

  it("lists are trimmed, capped at 8 and symptoms lowercased", () => {
    const out = parseEnrichmentReply(JSON.stringify({ symptoms: Array.from({ length: 12 }, (_, i) => `  Symptom ${i} `) }));
    expect(out?.symptoms).toHaveLength(8);
    expect(out?.symptoms?.[0]).toBe("symptom 0");
  });
});

describe("readEnrichment — stored blob re-validates through the same pickers", () => {
  it("returns null without the provider/model/at stamp", () => {
    expect(readEnrichment(JSON.stringify({ enrichment: { subject: "rotor" } }))).toBeNull();
    expect(readEnrichment("{broken")).toBeNull();
    expect(readEnrichment(null)).toBeNull();
  });
  it("a hand-corrupted service path cannot surface", () => {
    const stored = JSON.stringify({ originalFilename: "a.jpg", enrichment: { subject: "rotor", service: "/made-up", season: "fall", provider: "gemini", model: "m", at: "t" } });
    expect(readEnrichment(stored)).toEqual({ subject: "rotor", season: "fall", provider: "gemini", model: "m", at: "t" });
  });
});

describe("seasonFor — shop-local (America/New_York), not server-local", () => {
  it("23:30 UTC on Nov 30 is still Nov 30 in Cleveland → fall; 05:00 UTC Dec 1 → winter", () => {
    expect(seasonFor(new Date("2026-11-30T23:30:00Z"))).toBe("fall");
    expect(seasonFor(new Date("2026-12-01T05:00:00Z"))).toBe("winter");
    // 03:00 UTC Dec 1 is still 22:00 Nov 30 in Cleveland — fall, not winter.
    expect(seasonFor(new Date("2026-12-01T03:00:00Z"))).toBe("fall");
  });
  it("covers all four seasons", () => {
    expect(seasonFor(new Date("2026-04-15T12:00:00Z"))).toBe("spring");
    expect(seasonFor(new Date("2026-07-15T12:00:00Z"))).toBe("summer");
  });
});

type FakeRow = { id: string; runtimeUrl: string | null; generationParamsJson: string | null; createdAt: Date; width: number | null; height: number | null };
function fakeDb(row: FakeRow | null) {
  const sets: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
    update: () => ({ set: (v: Record<string, unknown>) => { sets.push(v); return { where: async () => undefined }; } }),
  } as unknown as DB;
  return { db, sets };
}
const baseRow: FakeRow = {
  id: "ma_1", runtimeUrl: "https://cdn.example/ma_1.jpg", createdAt: new Date("2026-10-01T12:00:00Z"), width: 1080, height: 1920,
  generationParamsJson: JSON.stringify({ originalFilename: "rotor.jpg", source: "instagram_studio_evidence" }),
};

describe("enrichRealShopAsset", () => {
  afterEach(() => { analyzePhoto.mockReset(); });

  it("no vision key → skipped with reason, no vision call, no write", async () => {
    const { db, sets } = fakeDb(baseRow);
    const r = await enrichRealShopAsset("ma_1", { database: db, env: {} });
    expect(r).toMatchObject({ skipped: true, reason: "no_vision_key" });
    expect(analyzePhoto).not.toHaveBeenCalled();
    expect(sets).toEqual([]);
  });

  it("asset not found / no runtime url are distinct skips", async () => {
    expect(await enrichRealShopAsset("ma_x", { database: fakeDb(null).db, env: { GEMINI_API_KEY: "k" } })).toMatchObject({ skipped: true, reason: "asset_not_found" });
    expect(await enrichRealShopAsset("ma_1", { database: fakeDb({ ...baseRow, runtimeUrl: null }).db, env: { GEMINI_API_KEY: "k" } })).toMatchObject({ skipped: true, reason: "no_runtime_url" });
  });

  it("provider failure → skipped vision_<reason>, nothing persisted", async () => {
    analyzePhoto.mockResolvedValue({ ok: false, error: "feature flag off", reason: "disabled" });
    const { db, sets } = fakeDb(baseRow);
    const r = await enrichRealShopAsset("ma_1", { database: db, env: { GEMINI_API_KEY: "k" } });
    expect(r).toMatchObject({ skipped: true, reason: "vision_disabled", error: "feature flag off" });
    expect(sets).toEqual([]);
  });

  it("garbage reply → skipped unparseable_reply, nothing persisted", async () => {
    analyzePhoto.mockResolvedValue({ ok: true, description: "A photo of a car part.", source: "gemini", modelName: "g", latencyMs: 1 });
    const { db, sets } = fakeDb(baseRow);
    expect(await enrichRealShopAsset("ma_1", { database: db, env: { GEMINI_API_KEY: "k" } })).toMatchObject({ skipped: true, reason: "unparseable_reply" });
    expect(sets).toEqual([]);
  });

  it("POSITIVE CONTROL: merges `enrichment` into generation_params_json, preserving other keys; gemini preferred over replicate", async () => {
    analyzePhoto.mockResolvedValue({ ok: true, description: '{"subject":"rotor","service":"/brakes","symptoms":["Grinding"],"quality":0.8}', source: "gemini", modelName: "gemini-2.5-flash", latencyMs: 1 });
    const { db, sets } = fakeDb(baseRow);
    const r = await enrichRealShopAsset("ma_1", { database: db, env: { GEMINI_API_KEY: "k", REPLICATE_API_KEY: "r" }, capturedAt: new Date("2026-10-01T12:00:00Z") });
    expect(r.skipped).toBe(false);
    expect(analyzePhoto).toHaveBeenCalledWith(expect.objectContaining({ photoUrl: baseRow.runtimeUrl, provider: "gemini" }));
    expect(sets).toHaveLength(1);
    const written = JSON.parse(String(sets[0].generationParamsJson));
    expect(written.originalFilename).toBe("rotor.jpg");
    expect(written.source).toBe("instagram_studio_evidence");
    expect(written.enrichment).toMatchObject({ subject: "rotor", service: "/brakes", symptoms: ["grinding"], quality: 0.8, season: "fall", orientation: "portrait", provider: "gemini", model: "gemini-2.5-flash" });
    expect(readEnrichment(String(sets[0].generationParamsJson))?.subject).toBe("rotor");
  });

  it("replicate is the fallback key", async () => {
    analyzePhoto.mockResolvedValue({ ok: true, description: '{"subject":"tire"}', source: "replicate", modelName: "llava", latencyMs: 1 });
    await enrichRealShopAsset("ma_1", { database: fakeDb(baseRow).db, env: { REPLICATE_API_KEY: "r" } });
    expect(analyzePhoto).toHaveBeenCalledWith(expect.objectContaining({ provider: "replicate" }));
  });

  it("a thrown DB error is a skip with reason=error, never a rejection into the upload path", async () => {
    const db = { select: () => { throw new Error("pool exhausted"); } } as unknown as DB;
    expect(await enrichRealShopAsset("ma_1", { database: db, env: { GEMINI_API_KEY: "k" } })).toMatchObject({ skipped: true, reason: "error", error: "pool exhausted" });
  });
});
