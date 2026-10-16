/**
 * Unit controls for the admin v1 six-feet distance (tests/e2e/admin-v1-distance.ts).
 *
 * Synthetic renders, no browser: a dark page with a header bar and a column of
 * list rows (the current admin's shape), the same page slid 16 to 64 px, and a
 * recomposed page (bottom bar, two-column card grid, no header). The real-render
 * controls (same page twice, a CSS shift, a different page) live in
 * admin-v1-gate.spec.ts; these pin the measure itself so a mutation of the
 * module (no registration, another cell size) goes red without a browser.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { gridDistance, massGrid, visualDistance } from "./admin-v1-distance";

type Block = [x: number, y: number, w: number, h: number, lum: number];

async function render(width: number, height: number, blocks: Block[], dx = 0, dy = 0): Promise<Buffer> {
  const px = Buffer.alloc(width * height, 12); // near-black void, like the admin background
  for (const [bx, by, bw, bh, lum] of blocks) {
    for (let y = Math.max(0, by + dy); y < Math.min(height, by + dy + bh); y++) {
      for (let x = Math.max(0, bx + dx); x < Math.min(width, bx + dx + bw); x++) px[y * width + x] = lum;
    }
  }
  return sharp(px, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

/** Current admin shape: a header bar, a stat strip, then a single column of ruled rows. */
function listPage(width: number, height: number): Block[] {
  const blocks: Block[] = [[0, 0, width, 56, 40], [16, 18, 120, 20, 200]];
  const col = Math.min(width - 32, 900);
  const left = Math.round((width - col) / 2);
  for (let i = 0; i < 4; i++) blocks.push([left + i * Math.round(col / 4), 80, Math.round(col / 4) - 12, 72, 70]);
  for (let y = 180; y < height - 40; y += 64) {
    blocks.push([left, y, col, 2, 90]); // rule
    blocks.push([left + 8, y + 16, Math.round(col * 0.45), 14, 210]); // name
    blocks.push([left + 8, y + 38, Math.round(col * 0.3), 10, 140]); // detail
  }
  return blocks;
}

/** Recomposed: no header, big focal card, two-column grid of cards, a bottom bar. */
function cardPage(width: number, height: number): Block[] {
  const blocks: Block[] = [[0, height - 72, width, 72, 60]];
  blocks.push([16, 24, width - 32, 220, 150]);
  const cw = Math.round((width - 48) / 2);
  for (let y = 270; y < height - 220; y += 200) {
    blocks.push([16, y, cw, 180, 110]);
    blocks.push([32 + cw, y, cw, 180, 110]);
  }
  return blocks;
}

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
];

describe("admin-v1 distance: controls per viewport", () => {
  for (const vp of VIEWPORTS) {
    const size = { width: vp.width, height: vp.height };

    it(`${vp.name}: identical renders score 0.000`, async () => {
      const a = await render(vp.width, vp.height, listPage(vp.width, vp.height));
      const b = await render(vp.width, vp.height, listPage(vp.width, vp.height));
      expect((await visualDistance(a, b, size)).ratio).toBe(0);
    });

    for (const [dx, dy] of [[16, 0], [0, 40], [64, 16], [32, 64]] as const) {
      it(`${vp.name}: a ${dx}x${dy} px shift stays under 0.35`, async () => {
        const a = await render(vp.width, vp.height, listPage(vp.width, vp.height));
        const b = await render(vp.width, vp.height, listPage(vp.width, vp.height), dx, dy);
        const d = await visualDistance(a, b, size);
        expect(d.ratio).toBeLessThan(0.35);
      });
    }

    it(`${vp.name}: a recomposed render scores above 0.35`, async () => {
      const a = await render(vp.width, vp.height, listPage(vp.width, vp.height));
      const b = await render(vp.width, vp.height, cardPage(vp.width, vp.height));
      expect((await visualDistance(a, b, size)).ratio).toBeGreaterThan(0.35);
    });
  }
});

describe("admin-v1 distance: the measure", () => {
  it("grids are 48 px cells of the viewport, not of the device pixels", async () => {
    // A 3x device-scale phone screenshot is 1170 px wide; the grid must still be 390/48.
    const png = await render(1170, 2532, []);
    const g = await massGrid(png, { width: 390, height: 844 });
    expect([g.cols, g.rows]).toEqual([8, 18]);
  });

  it("registration finds the shift: a grid slid one cell matches at distance 0 inside the overlap", () => {
    const a = { cols: 6, rows: 1, data: Float64Array.from([0, 0, 200, 0, 0, 0]) };
    const b = { cols: 6, rows: 1, data: Float64Array.from([0, 0, 0, 200, 0, 0]) };
    const d = gridDistance(a, b, 2);
    expect(d.ratio).toBe(0);
    expect(d.shift).toEqual({ dx: 1, dy: 0 });
    expect(gridDistance(a, b, 0).ratio).toBe(1);
  });

  it("visualDistance itself reduces to 48 px cells: 8x18 at 390x844, 30x19 at 1440x900", async () => {
    const phone = await render(390, 844, listPage(390, 844));
    const desk = await render(1440, 900, listPage(1440, 900));
    const p = await visualDistance(phone, phone, { width: 390, height: 844 });
    const d = await visualDistance(desk, desk, { width: 1440, height: 900 });
    expect([p.cols, p.rows]).toEqual([8, 18]);
    expect([d.cols, d.rows]).toEqual([30, 19]);
  });

  it("1440: a 96x96 px slide needs registration (unregistered it reads as a redesign) and the shift is found", async () => {
    const size = { width: 1440, height: 900 };
    const a = await render(1440, 900, listPage(1440, 900));
    const b = await render(1440, 900, listPage(1440, 900), 96, 96);
    const registered = await visualDistance(a, b, size);
    const unregistered = await visualDistance(a, b, size, { reach: 0 });
    expect(unregistered.ratio).toBeGreaterThan(0.35);
    expect(registered.ratio).toBeLessThan(0.35);
    expect(registered.shift).not.toEqual({ dx: 0, dy: 0 });
  });

  it("measures luminance, not one colour channel: a pure green block on the void scores above 0.3", async () => {
    const width = 390;
    const height = 844;
    const voidPx = Buffer.alloc(width * height * 3, 0); // pure black: a red-only read sees nothing at all
    const green = Buffer.from(voidPx);
    for (let y = 200; y < 700; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        green[i] = 0;
        green[i + 1] = 255;
        green[i + 2] = 0;
      }
    }
    const png = (px: Buffer) => sharp(px, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const d = await visualDistance(await png(voidPx), await png(green), { width, height });
    expect(d.ratio).toBeGreaterThan(0.3);
  });

  it("two all-black renders score 0, not NaN", () => {
    const z = { cols: 2, rows: 2, data: new Float64Array(4) };
    expect(gridDistance(z, z).ratio).toBe(0);
  });
});
