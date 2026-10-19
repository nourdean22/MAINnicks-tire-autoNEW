/**
 * instagramStudio.uploadEvidencePhoto with scoreOnly (the Photo Improver's upload).
 *
 * The default upload registers every photo as reusable real-shop media and runs a vision
 * enrichment on it; the unattended Instagram autopost reads that pool. A photo uploaded only to be
 * SCORED must reach neither: scoreOnly stores it under photo-check/ (outside the pool and outside
 * pickSubjectImage's evidence prefix) and skips the registry and the enrichment. The default path
 * is pinned here too so the flag cannot change what the Studio's own upload does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storagePut, getDb, registerProducedAsset, enrichRealShopAsset } = vi.hoisted(() => ({
  storagePut: vi.fn(),
  getDb: vi.fn(),
  registerProducedAsset: vi.fn(),
  enrichRealShopAsset: vi.fn(),
}));
vi.mock("../storage", async (importOriginal) => ({ ...(await importOriginal<typeof import("../storage")>()), storagePut }));
vi.mock("../db", async (importOriginal) => ({ ...(await importOriginal<typeof import("../db")>()), getDb }));
vi.mock("../services/mediaRegistry", async (importOriginal) => ({ ...(await importOriginal<typeof import("../services/mediaRegistry")>()), registerProducedAsset }));
vi.mock("../services/mediaEnrichment", async (importOriginal) => ({ ...(await importOriginal<typeof import("../services/mediaEnrichment")>()), enrichRealShopAsset }));

import { instagramStudioRouter } from "./instagramStudio";
import type { TrpcContext } from "../_core/context";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
const HTML = Buffer.from("<html><script>alert(1)</script></html>");

function caller() {
  return instagramStudioRouter.createCaller({
    user: { id: 1, openId: "openid-upload-admin", email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext);
}

const upload = (extra: { scoreOnly?: boolean } = {}, buf: Buffer = JPEG) =>
  caller().uploadEvidencePhoto({ base64: buf.toString("base64"), filename: "front.jpg", mimeType: "image/jpeg", ...extra });

/** The enrichment is fire-and-forget behind a dynamic import: give it time to run (or not run). */
const settle = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  for (const m of [storagePut, getDb, registerProducedAsset, enrichRealShopAsset]) m.mockReset();
  storagePut.mockImplementation(async (key: string) => ({ key, url: `https://shop.example.test/generated/${key}` }));
  // The admin gate reads its role row through this same handle: an empty result is "no row yet" (the
  // documented owner fallback). A bare {} would make that read throw and refuse the write.
  getDb.mockResolvedValue({ execute: async () => [[]] });
  registerProducedAsset.mockResolvedValue({ id: "asset-1" });
  enrichRealShopAsset.mockResolvedValue({ skipped: false, assetId: "asset-1" });
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("uploadEvidencePhoto scoreOnly", () => {
  it("stores under photo-check/, registers nothing, enriches nothing, and returns the same shape with a null assetId", async () => {
    const r = await upload({ scoreOnly: true });
    expect(storagePut).toHaveBeenCalledTimes(1);
    expect(storagePut.mock.calls[0][0]).toMatch(/^photo-check\/\d+-\d{6}-front\.jpg$/);
    expect(storagePut.mock.calls[0][2]).toBe("image/jpeg");
    expect(r).toEqual({ url: expect.stringContaining("/generated/photo-check/"), assetId: null });
    await settle();
    expect(registerProducedAsset).not.toHaveBeenCalled();
    expect(enrichRealShopAsset).not.toHaveBeenCalled();
  });

  it("keeps the byte sniff: a non-image declared as image/jpeg is refused and nothing is stored", async () => {
    await expect(upload({ scoreOnly: true }, HTML)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storagePut).not.toHaveBeenCalled();
  });

  it("keeps the mime allowlist and the size cap at the input", async () => {
    await expect(
      caller().uploadEvidencePhoto({ base64: JPEG.toString("base64"), filename: "a.svg", mimeType: "image/svg+xml" as "image/jpeg", scoreOnly: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().uploadEvidencePhoto({ base64: "A".repeat(10_000_001), filename: "a.jpg", mimeType: "image/jpeg", scoreOnly: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storagePut).not.toHaveBeenCalled();
  });

  it.each([["scoreOnly false", { scoreOnly: false }], ["no flag", {}]])(
    "%s keeps the Studio behaviour: ig-evidence/ key, registered as real-shop media, enriched",
    async (_label, extra) => {
      const r = await upload(extra);
      expect(storagePut.mock.calls[0][0]).toMatch(/^ig-evidence\/\d+-\d{6}-front\.jpg$/);
      expect(r).toEqual({ url: expect.stringContaining("/generated/ig-evidence/"), assetId: "asset-1" });
      expect(registerProducedAsset).toHaveBeenCalledTimes(1);
      expect(registerProducedAsset.mock.calls[0][2]).toMatchObject({ assetType: "instagram_evidence_photo", rightsStatus: "real_shop", provider: "operator_upload" });
      await vi.waitFor(() => expect(enrichRealShopAsset).toHaveBeenCalledTimes(1));
      expect(enrichRealShopAsset.mock.calls[0][0]).toBe("asset-1");
    },
  );
});
