/**
 * Upload routes decide the image type from the BYTES (2026-10-08).
 *
 * Before: booking.uploadPhoto (PUBLIC), services.uploadPhoto and
 * instagramStudio.uploadEvidencePhoto stored whatever arrived under the
 * client-declared mimeType. Any payload could enter storage as "image/jpeg".
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import type { TrpcContext } from "../_core/context";

const { puts } = vi.hoisted(() => ({ puts: [] as Array<{ key: string; type: string }> }));
vi.mock("../storage", () => ({
  storagePut: async (key: string, _buf: Buffer, type: string) => {
    puts.push({ key, type });
    return { url: `https://store.example/${key}` };
  },
}));

import { sniffImageMime } from "../lib/imageSignature";
import { bookingRouter } from "../routers/booking";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.from([0, 0, 0, 0])]);
const HEIF = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmif1"), Buffer.from([0, 0, 0, 0])]);
const HTML = Buffer.from("<html><script>alert(1)</script></html>");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>');

describe("sniffImageMime", () => {
  it("names each allowed type from its signature", () => {
    expect([JPEG, PNG, WEBP, HEIC, HEIF].map(sniffImageMime)).toEqual(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
  });
  it("refuses non-images, including SVG and an MP4 ftyp brand", () => {
    const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from([0, 0, 0, 0])]);
    expect([HTML, SVG, MP4, Buffer.alloc(0)].map(sniffImageMime)).toEqual([null, null, null, null]);
  });
});

const publicCtx = (): TrpcContext => ({
  user: null,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => {} } as TrpcContext["res"],
});

describe("booking.uploadPhoto (public) — bytes decide", () => {
  beforeEach(() => { puts.length = 0; });
  const call = (buf: Buffer, mimeType: "image/jpeg" | "image/heic") =>
    bookingRouter.createCaller(publicCtx()).uploadPhoto({ base64: buf.toString("base64"), filename: "photo.jpg", mimeType });

  it("refuses a non-image declared as image/jpeg, and stores nothing", async () => {
    await expect(call(HTML, "image/jpeg")).rejects.toThrow(/not a photo/);
    expect(puts).toEqual([]);
  });

  it("accepts a mislabelled real photo and stores it under its true type", async () => {
    await call(HEIC, "image/jpeg");
    expect(puts).toHaveLength(1);
    expect(puts[0].type).toBe("image/heic");
  });

  it("a correctly labelled JPEG is unchanged", async () => {
    await call(JPEG, "image/jpeg");
    expect(puts[0].type).toBe("image/jpeg");
  });
});

describe("every upload route sniffs the bytes before storing (the public route is driven above; the two admin routes are pinned here)", () => {
  for (const [file, proc] of [["booking.ts", "uploadPhoto"], ["services.ts", "uploadPhoto"], ["instagramStudio.ts", "uploadEvidencePhoto"]] as const) {
    it(`${file} ${proc}: sniff → refuse non-image → store under the sniffed type`, () => {
      const src = readFileSync(new URL(`../routers/${file}`, import.meta.url), "utf8");
      const start = src.indexOf(`${proc}:`);
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("}),", start));
      const sniff = body.indexOf("const mime = sniffImageMime(buffer);");
      const refuse = body.indexOf('if (!mime) throw new TRPCError({ code: "BAD_REQUEST", message: NOT_AN_IMAGE_MESSAGE });');
      const store = body.indexOf("storagePut(key, buffer, mime)");
      expect(sniff).toBeGreaterThan(-1);
      expect(refuse).toBeGreaterThan(sniff);
      expect(store).toBeGreaterThan(refuse);
      expect(body).not.toContain("storagePut(key, buffer, input.mimeType)");
    });
  }
});
