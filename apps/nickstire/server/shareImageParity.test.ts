/**
 * Share-image parity — the three places a link-preview image is declared must
 * agree, and the file they name must exist at the size the platforms want.
 *
 * WHY (2026-09-07): index.html was fixed to point og:image at /og-image.jpg,
 * but SEOHead's default still wrote a 1672x941 WebP after hydration — and the
 * prerendered snapshots (what facebookexternalhit / Twitterbot actually read)
 * capture the hydrated head. So the fix reached human visitors and no one
 * else. This test fails if any one of the three sources drifts again.
 *
 * Static: reads source files and the image bytes. The live counterpart is a
 * GET of the deployed page and image (docs/QUALITY-PROGRAM-2026-09-07.md §11).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd(); // apps/nickstire
const OG_URL = "https://nickstire.org/og-image.jpg";
const OG_FILE = join(ROOT, "client", "public", "og-image.jpg");

/** Width/height from the first SOF0/SOF2 marker of a baseline/progressive JPEG. */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null; // not a JPEG
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return null;
}

describe("share image parity", () => {
  const indexHtml = readFileSync(join(ROOT, "client", "index.html"), "utf8");
  const seoTsx = readFileSync(join(ROOT, "client", "src", "components", "SEO.tsx"), "utf8");

  it("index.html declares the JPEG for both og:image and twitter:image", () => {
    expect(indexHtml).toContain(`<meta property="og:image" content="${OG_URL}" />`);
    expect(indexHtml).toContain(`<meta name="twitter:image" content="${OG_URL}" />`);
    expect(indexHtml).toContain('<meta property="og:image:type" content="image/jpeg" />');
    expect(indexHtml).not.toMatch(/og:image" content="[^"]*cloudfront/);
  });

  it("SEOHead's default image is the same JPEG (what the prerendered snapshots carry)", () => {
    expect(seoTsx).toMatch(/defaultOgImage = ogImage \|\| `\$\{BASE_URL\}\/og-image\.jpg`/);
    expect(seoTsx).not.toContain("shop-exterior-hero-wide-sign-bays.webp`");
  });

  it("the file exists and is a 1200x630 JPEG", () => {
    expect(existsSync(OG_FILE)).toBe(true);
    const size = jpegSize(readFileSync(OG_FILE));
    expect(size).toEqual({ width: 1200, height: 630 });
  });

  it("canary: the JPEG size reader is not vacuous", () => {
    // Minimal SOF0 segment: FFD8, FFC0, len=17, precision, height=2, width=3 ...
    const fake = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(jpegSize(fake)).toEqual({ width: 3, height: 2 });
    expect(jpegSize(Buffer.from("not a jpeg"))).toBeNull();
  });
});
