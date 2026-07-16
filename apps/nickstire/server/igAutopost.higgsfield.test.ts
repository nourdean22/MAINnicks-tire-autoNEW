import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Higgsfield provider wiring (audit WS2, operator re-funded the plan).
 *
 * Before this fix, "higgsfield" in the Settings provider dropdown was a
 * deprecated stub: generatePostImage silently rendered the branded poster
 * instead, so the operator got a different image than the UI claimed. These
 * tests pin the wiring: the selection must reach the real Higgsfield
 * generator, and a Higgsfield failure must fall back to an image, not a
 * missed post.
 */
const { dbRows, hgGenerate, storagePut, fallbackGenerate } = vi.hoisted(() => ({
  dbRows: [] as Array<{ k: string; v: string }>,
  hgGenerate: vi.fn<() => Promise<string>>(),
  storagePut: vi.fn(async (name: string) => ({ url: `https://cdn.nickstire.org/${name}` })),
  fallbackGenerate: vi.fn(async () => ({ url: "https://fallback.example/img.png" })),
}));

vi.mock("./lib/db-helper", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(dbRows);
  const database = { select: () => chain };
  return { db: async () => database, dbTyped: async () => database, requireDb: async () => database };
});

vi.mock("./services/higgsfieldStudio", () => ({
  generateCarouselSlideImage: hgGenerate,
  getHiggsfieldCredentialsJson: async () => JSON.stringify({ key: "test" }),
}));

vi.mock("./storage", () => ({ storagePut }));

vi.mock("./_core/imageGeneration", () => ({ generateImage: fallbackGenerate }));

import { generatePostImage } from "./services/igAutopost";

// 1x1 transparent PNG — real bytes so the sharp-based jpeg conversion works.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

beforeEach(() => {
  dbRows.length = 0;
  dbRows.push({ k: "ig_autopost_image_provider", v: "higgsfield" });
  hgGenerate.mockReset().mockResolvedValue("https://higgsfield.example/generated.png");
  storagePut.mockClear();
  fallbackGenerate.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => TINY_PNG.buffer.slice(TINY_PNG.byteOffset, TINY_PNG.byteOffset + TINY_PNG.byteLength),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("generatePostImage provider=higgsfield", () => {
  it("routes to the REAL Higgsfield generator, not the poster stub", async () => {
    const res = await generatePostImage("tire shop hero shot");

    expect(hgGenerate).toHaveBeenCalledWith("tire shop hero shot");
    // The Higgsfield-hosted URL must be re-hosted onto our storage as jpeg.
    expect(storagePut).toHaveBeenCalled();
    expect(res.kind).toBe("ai");
    expect(res.format).toBe("jpeg");
    expect(res.url).toContain("cdn.nickstire.org");
  });

  it("falls back to another image on Higgsfield failure — never an imageless post", async () => {
    hgGenerate.mockRejectedValue(new Error("higgsfield CLI exited 1"));
    const res = await generatePostImage("tire shop hero shot");

    expect(fallbackGenerate).toHaveBeenCalled();
    expect(res.kind).toBe("ai");
    expect(res.url).toBeTruthy();
  });
});
