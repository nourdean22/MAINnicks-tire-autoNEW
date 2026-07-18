/**
 * materializeStartImage — the CC2 image-conditioning fix, plus the second-pass
 * audit hardening.
 *
 * The Higgsfield CLI's --start-image needs a UUID or a local FILE PATH (a public
 * URL hard-fails), so we download the hero frame to a temp file. Two contracts
 * are under test:
 *   1. ANY failure degrades to text-only (return null) — never throw, never kill
 *      a paid render over an optional enhancement.
 *   2. The download is treated as untrusted: non-public hosts refused, redirect
 *      hops re-validated, size capped, and the file type decided by MAGIC BYTES
 *      rather than by the URL's extension.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { materializeStartImage } from "./services/higgsfieldStudio";

/** Minimal Response stand-in: the impl streams via body.getReader(). */
function okImage(bytes: Uint8Array, headers: Record<string, string> = {}) {
  let sent = false;
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
        cancel: async () => {},
      }),
    },
  };
}
const redirectTo = (location: string) => ({
  ok: false,
  status: 302,
  headers: { get: (k: string) => (k.toLowerCase() === "location" ? location : null) },
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

describe("materializeStartImage — degrade, never throw", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns null when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(materializeStartImage("https://x/hero.png")).resolves.toBeNull();
  });

  it("returns null on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => null } })));
    await expect(materializeStartImage("https://x/hero.png")).resolves.toBeNull();
  });

  it("returns null on an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okImage(new Uint8Array(0))));
    await expect(materializeStartImage("https://x/hero.png")).resolves.toBeNull();
  });
});

describe("materializeStartImage — the download is untrusted input", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("names the file from the MAGIC BYTES, not the URL extension", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okImage(PNG)));
    // URL claims .jpg; the bytes are a PNG. The CLI acts on the bytes.
    const p = await materializeStartImage("https://cdn.example/hero.jpg?sig=abc");
    expect(p).toMatch(/\.png$/);
    const fs = await import("fs");
    expect(fs.existsSync(p!)).toBe(true);
    fs.unlinkSync(p!);
  });

  it("refuses a body that is not a JPEG/PNG/WebP however the URL is named", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okImage(new Uint8Array([0x3c, 0x21, 0x44, 0x4f])))); // "<!DO"
    await expect(materializeStartImage("https://cdn.example/hero.png")).resolves.toBeNull();
  });

  it.each([
    ["loopback", "http://127.0.0.1/hero.png"],
    ["metadata endpoint", "http://169.254.169.254/latest/meta-data/hero.png"],
    ["private range", "http://10.0.0.5/hero.png"],
    ["private range (172.16)", "http://172.16.4.4/hero.png"],
    ["localhost", "http://localhost:8080/hero.png"],
    ["non-http scheme", "file:///etc/passwd"],
  ])("refuses a non-public host: %s", async (_label, url) => {
    const fetchSpy = vi.fn(async () => okImage(PNG));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(materializeStartImage(url)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled(); // refused BEFORE any request left the box
  });

  it("re-validates each redirect hop — a public URL cannot bounce into the private network", async () => {
    const fetchSpy = vi.fn(async () => redirectTo("http://169.254.169.254/latest/meta-data/"));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(materializeStartImage("https://cdn.example/hero.png")).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // the hop was checked, not followed
  });

  it("follows a public redirect and keeps the image", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(redirectTo("https://cdn2.example/real.jpg"))
      .mockResolvedValueOnce(okImage(JPG));
    vi.stubGlobal("fetch", fetchSpy);
    const p = await materializeStartImage("https://cdn.example/hero.jpg");
    expect(p).toMatch(/\.jpg$/);
    const fs = await import("fs");
    fs.unlinkSync(p!);
  });

  it("gives up rather than chasing a redirect loop", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => redirectTo("https://cdn.example/again.png")));
    await expect(materializeStartImage("https://cdn.example/hero.png")).resolves.toBeNull();
  });

  it("refuses an oversized image on the declared content-length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okImage(PNG, { "content-length": String(64 * 1024 * 1024) })));
    await expect(materializeStartImage("https://cdn.example/hero.png")).resolves.toBeNull();
  });

  it("caps the read even when content-length lies", async () => {
    const chunk = new Uint8Array(4 * 1024 * 1024);
    chunk.set(PNG.subarray(0, 8));
    let sent = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      headers: { get: () => null }, // no content-length at all
      body: { getReader: () => ({ read: async () => (sent++ < 32 ? { done: false, value: chunk } : { done: true }), cancel: async () => {} }) },
    })));
    await expect(materializeStartImage("https://cdn.example/hero.png")).resolves.toBeNull();
  });
});
