/**
 * materializeStartImage — the CC2 image-conditioning fix. The Higgsfield CLI's
 * --start-image needs a UUID or a local FILE PATH (a public URL hard-fails), so
 * we download the hero frame to a temp file. A download failure must degrade to
 * text-only (return null), never throw and kill the render.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { materializeStartImage } from "./services/higgsfieldStudio";

describe("materializeStartImage", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns null (never throws) when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(materializeStartImage("https://x/hero.png")).resolves.toBeNull();
  });

  it("returns null on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(materializeStartImage("https://x/hero.png")).resolves.toBeNull();
  });

  it("returns null on an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
    await expect(materializeStartImage("https://x/hero.png")).resolves.toBeNull();
  });

  it("writes a temp file with the URL's image extension and returns its path", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer })));
    const p = await materializeStartImage("https://cdn.example/hero.jpg?sig=abc");
    expect(p).toMatch(/\.jpg$/);
    const fs = await import("fs");
    expect(fs.existsSync(p!)).toBe(true);
    fs.unlinkSync(p!);
  });
});
