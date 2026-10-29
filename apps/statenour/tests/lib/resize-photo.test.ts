/** The encode search behind task photo upload (2026-10-29): WebP first, JPEG when the browser fakes WebP, never over the cap. */
import { describe, it, expect } from "vitest";
import { encodeUnderCap } from "@/lib/ui/resize-photo";

const blob = (type: string, size: number) => new Blob([new Uint8Array(size)], { type });

describe("encodeUnderCap", () => {
  it("keeps the first WebP that fits", async () => {
    const out = await encodeUnderCap(async (type) => blob(type, 100), 1000);
    expect(out?.blob.type).toBe("image/webp");
    expect(out?.scale).toBe(1);
  });

  it("falls back to JPEG when toBlob returns PNG for WebP (Safari)", async () => {
    const out = await encodeUnderCap(async (type) => (type === "image/webp" ? blob("image/png", 10) : blob(type, 100)), 1000);
    expect(out?.blob.type).toBe("image/jpeg");
  });

  it("steps quality, then size, down until it fits", async () => {
    const tried: string[] = [];
    const out = await encodeUnderCap(async (type, q, s) => {
      tried.push(`${q}@${s}`);
      return blob(type, q <= 0.5 && s <= 0.8 ? 900 : 5000);
    }, 1000);
    expect(out?.scale).toBe(0.8);
    expect(tried[0]).toBe("0.85@1");
    expect(out!.blob.size).toBeLessThanOrEqual(1000);
  });

  it("returns null rather than an oversize file", async () => {
    expect(await encodeUnderCap(async (type) => blob(type, 5000), 1000)).toBeNull();
  });
});
