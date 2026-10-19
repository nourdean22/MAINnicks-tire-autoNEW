/**
 * import-shop-media.mts: the dry-run guard, the trust-boundary schema and the
 * D2 import rules.
 *
 * The guard is pinned by BEHAVIOUR: the DB, storage and registry modules are
 * mocked with factories that record when they are loaded. A dry run (and a
 * refused catalog) must finish with none of them loaded; an --execute run must
 * load them. Break the guard (import before the dry-run return) and the first
 * test goes red.
 */
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  loaded: { db: false, storage: false, registry: false },
  puts: [] as Array<{ key: string; mime: string; bytes: number }>,
  registered: [] as Array<Record<string, unknown>>,
  existing: new Map<string, string>(),
}));

vi.mock("../server/db", () => {
  h.loaded.db = true;
  return { getDbTyped: async () => ({}) };
});
vi.mock("../server/storage", () => {
  h.loaded.storage = true;
  return {
    assertDurableStorageForGeneration: () => {},
    storagePut: async (key: string, data: Buffer, mime: string) => {
      h.puts.push({ key, mime, bytes: data.length });
      return { key, url: `https://cdn.test/${key}` };
    },
  };
});
vi.mock("../server/services/mediaRegistry", () => {
  h.loaded.registry = true;
  return {
    findByChecksum: async (_db: unknown, sha: string) => (h.existing.has(sha) ? [{ id: h.existing.get(sha), rightsStatus: "real_shop" }] : []),
    registerAsset: async (_db: unknown, input: Record<string, unknown>) => {
      const id = `ma_test_${h.registered.length + 1}`;
      h.registered.push({ ...input, id });
      return { id, ...input };
    },
  };
});

import { run } from "./import-shop-media.mts";

const FIXTURE = path.join(__dirname, "__fixtures__", "shop-media-catalog.sample.json");
let dir = "";
let catalogPath = "";

/** The sample fixture, pointed at tiny real files whose sha256 is computed here. */
function writeCatalog(mutate?: (c: { version: number; items: Array<Record<string, unknown>> }) => void): string {
  const catalog = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  for (const item of catalog.items) {
    const ext = path.extname(item.file);
    const file = path.join(dir, `${item.id}${ext}`);
    const bytes = Buffer.from(`bytes of ${item.id}`);
    fs.writeFileSync(file, bytes);
    item.file = file;
    item.bytes = bytes.length;
    item.sha256 = createHash("sha256").update(bytes).digest("hex");
  }
  mutate?.(catalog);
  const p = path.join(dir, `catalog-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(catalog));
  return p;
}

function io() {
  const out: string[] = [];
  return { out, io: { log: (s: string) => out.push(s), error: (s: string) => out.push(s) } };
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-media-"));
  catalogPath = writeCatalog();
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });
afterEach(() => {
  h.loaded.db = false; h.loaded.storage = false; h.loaded.registry = false;
  h.puts.length = 0; h.registered.length = 0; h.existing.clear();
});

describe("import-shop-media dry run (the default)", () => {
  it("prints per-kind counts, bytes and refusals and never loads the DB, storage or registry modules", async () => {
    const { out, io: sink } = io();
    const code = await run([catalogPath], sink);
    const text = out.join("\n");
    expect(code).toBe(0);
    expect(text).toMatch(/kind photo: 2 to import/);
    expect(text).toMatch(/kind video: 2 to import/);
    expect(text).toMatch(/generative \(ai_generated\): 1/);
    expect(text).toMatch(/refused sensitive: 1/);
    expect(text).toMatch(/skipped: 1/);
    expect(text).toMatch(/DRY RUN/);
    expect(h.loaded).toEqual({ db: false, storage: false, registry: false });
    expect(h.puts).toHaveLength(0);
  });

  it("refuses an item whose file no longer hashes to the catalog sha256", async () => {
    const p = writeCatalog((c) => { c.items[0].sha256 = "f".repeat(64); });
    const { out, io: sink } = io();
    expect(await run([p], sink)).toBe(0);
    expect(out.join("\n")).toMatch(/refused sha_mismatch: 1/);
    expect(out.join("\n")).toMatch(/kind photo: 1 to import/);
  });

  it("reads the catalog path wherever it sits in argv (a --limit value is not the catalog)", async () => {
    const { out, io: sink } = io();
    expect(await run(["--limit", "1", catalogPath], sink)).toBe(0);
    expect(out.join("\n")).toMatch(/kind photo: 2 to import/);
  });

  it("accepts a capture time with no UTC offset (camera-roll local time)", async () => {
    const p = writeCatalog((c) => { c.items[0].capturedAt = "2024-05-11T14:02:00"; });
    const { out, io: sink } = io();
    expect(await run([p], sink)).toBe(0);
    expect(out.join("\n")).toMatch(/kind photo: 2 to import/);
  });

  it("refuses the WHOLE catalog on a schema error, before any import", async () => {
    const p = writeCatalog((c) => { (c.items[1] as Record<string, unknown>).kind = "gif"; });
    const { out, io: sink } = io();
    expect(await run([p, "--execute"], sink)).toBe(2);
    expect(out.join("\n")).toMatch(/REFUSING/);
    expect(h.loaded).toEqual({ db: false, storage: false, registry: false });
  });
});

describe("import-shop-media --execute", () => {
  it("registers real items quarantined, never reusable, and AI edits as ai_generated with lineage", async () => {
    const { io: sink } = io();
    expect(await run([catalogPath, "--execute"], sink)).toBe(0);
    expect(h.loaded).toEqual({ db: true, storage: true, registry: true });

    const byCatalogId = new Map(h.registered.map((r) => [(r.generationParams as { catalogId: string }).catalogId, r]));
    expect([...byCatalogId.keys()].sort()).toEqual(["REC-PHOTO-1", "REC-REPAINT", "REC-VIDEO-H", "REC-VIDEO-V"]);

    for (const id of ["REC-PHOTO-1", "REC-VIDEO-H", "REC-VIDEO-V"]) {
      const r = byCatalogId.get(id)!;
      expect(r).toMatchObject({ rightsStatus: "real_shop", provider: "operator_capture", lifecycleState: "quarantined", reuseAllowed: false });
      expect((r.generationParams as { attestation?: string }).attestation).toBe("edited: color/exposure/crop/trim/stabilize only");
    }
    const repaint = byCatalogId.get("REC-REPAINT")!;
    expect(repaint).toMatchObject({ rightsStatus: "ai_generated", provider: "operator_ai_edit", lifecycleState: "quarantined", reuseAllowed: false });
    expect(repaint.derivedFrom).toEqual([byCatalogId.get("REC-PHOTO-1")!.id]);
    expect((repaint.generationParams as { attestation?: string }).attestation).toBeUndefined();

    // A horizontal video is stored, not refused, with its dimensions.
    expect(byCatalogId.get("REC-VIDEO-H")).toMatchObject({ format: "video", assetType: "shop_clip", width: 1920, height: 1080, durationMs: 6000, mimeType: "video/quicktime" });
    expect(byCatalogId.get("REC-PHOTO-1")).toMatchObject({ format: "image", assetType: "shop_photo", mimeType: "image/jpeg" });
    const photo = byCatalogId.get("REC-PHOTO-1")!;
    const sha12 = String(photo.checksumSha256).slice(0, 12);
    expect(photo.logicalKey).toBe(`shop_media:${sha12}`);
    expect(photo.runtimeUrl).toBe(`https://cdn.test/shop-media/2024/${sha12}.jpg`);
  });

  it("never uploads a sensitive item or a skipped one", async () => {
    const { io: sink } = io();
    await run([catalogPath, "--execute"], sink);
    expect(h.puts).toHaveLength(4);
    const keys = h.registered.map((r) => (r.generationParams as { catalogId: string }).catalogId);
    expect(keys).not.toContain("REC-SENSITIVE");
    expect(keys).not.toContain("REC-SKIP");
  });

  it("dedupes against the registry by checksum and honours --limit", async () => {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    h.existing.set(catalog.items[0].sha256, "ma_already");
    const { out, io: sink } = io();
    expect(await run([catalogPath, "--execute", "--limit", "1"], sink)).toBe(0);
    expect(h.puts).toHaveLength(1);
    expect(h.registered).toHaveLength(1);
    expect(out.join("\n")).toMatch(/already registered.*ma_already/);
  });
});
