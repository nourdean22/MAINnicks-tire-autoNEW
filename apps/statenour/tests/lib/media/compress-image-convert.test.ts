/**
 * U5 (2026-10-30) · a still photo the model providers cannot read is always re-encoded as JPEG.
 *
 * Before: only files over 600 KB were touched, so a small iPhone HEIC went out raw and the model
 * got bytes it could not decode. Also pins the white fill (a transparent PNG must not turn black).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prepareForSend } from "@/lib/media/compress-image";

const fills: string[] = [];

beforeEach(() => {
  fills.length = 0;
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close: () => {} })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    const ctx = {
      fillStyle: "",
      fillRect: () => fills.push(ctx.fillStyle),
      drawImage: () => {},
    };
    return ctx as never;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb: BlobCallback) {
    cb(new Blob([new Uint8Array(5000)], { type: "image/jpeg" }));
  });
});

describe("prepareForSend · format conversion", () => {
  it("a small HEIC is re-encoded as JPEG even when the JPEG is bigger", async () => {
    const heic = new File([new Uint8Array(1000)], "IMG_1.HEIC", { type: "image/heic" });
    const out = await prepareForSend(heic);
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.filename).toBe("IMG_1.jpg");
    expect(fills).toEqual(["#fff"]);
  });

  it("a small JPEG is sent as it is", async () => {
    const jpg = new File([new Uint8Array(1000)], "a.jpg", { type: "image/jpeg" });
    const out = await prepareForSend(jpg);
    expect(out.filename).toBe("a.jpg");
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
});
