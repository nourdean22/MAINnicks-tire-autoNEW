/**
 * tests/repo/visual-distance-metric.test.ts · 2026-09-16 · W7
 *
 * Canary for the Visible Transformation gate's instrument
 * (tests/e2e/visual-distance.ts). The gate is the inverse of a snapshot
 * test — it fails when a page still looks like the pre-wave render — so a
 * broken metric fails in the dangerous direction: a metric that reads every
 * pair as "far apart" would let an untouched page through. Three synthetic
 * renders pin the instrument:
 *
 *   · identical renders score 0 (a page that did not change cannot pass);
 *   · a render that merely SLID (the shell pushing the column right and
 *     down) scores low — a pixel count would call that a redesign;
 *   · a render whose composition changed scores high.
 *
 * The renders are drawn here, not captured: white "text lines" and one
 * "display heading" on a void-black 1440×900 page, drawn with the same
 * `sharp` the gate resolves through `next`.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { gridDistance, massGrid, visualDistance } from "../e2e/visual-distance";

const VIEWPORT = { width: 1440, height: 900 };

type Rect = { left: number; top: number; width: number; height: number };

interface SharpCompose {
  (opts: { create: { width: number; height: number; channels: 3; background: string } }): {
    composite(
      layers: { input: { create: { width: number; height: number; channels: 3; background: string } }; left: number; top: number }[],
    ): { png(): { toBuffer(): Promise<Buffer> } };
  };
}

function loadSharp(): SharpCompose {
  const requireFromNext = createRequire(require.resolve("next/package.json"));
  const mod = requireFromNext("sharp") as SharpCompose | { default: SharpCompose };
  return ("default" in mod ? mod.default : mod) as SharpCompose;
}

async function draw(rects: Rect[]): Promise<Buffer> {
  const sharp = loadSharp();
  return sharp({ create: { ...VIEWPORT, channels: 3, background: "#000" } })
    .composite(
      rects.map((r) => ({
        input: { create: { width: r.width, height: r.height, channels: 3, background: "#e6e6e6" } },
        left: r.left,
        top: r.top,
      })),
    )
    .png()
    .toBuffer();
}

/** The pre-wave shape: a narrow column of same-sized 16px lines. */
function preWave(dx = 0, dy = 0): Rect[] {
  const lines: Rect[] = [];
  for (let i = 0; i < 14; i++) {
    lines.push({ left: 160 + dx, top: 80 + i * 40 + dy, width: i % 3 === 0 ? 520 : 680, height: 16 });
  }
  return lines;
}

/** The recomposed shape: a display heading, a gold-rule lead, a second column. */
function recomposed(): Rect[] {
  return [
    { left: 160, top: 90, width: 640, height: 72 },
    { left: 160, top: 180, width: 420, height: 72 },
    { left: 160, top: 320, width: 4, height: 200 },
    { left: 190, top: 330, width: 560, height: 20 },
    { left: 190, top: 370, width: 600, height: 20 },
    { left: 190, top: 420, width: 180, height: 52 },
    { left: 980, top: 90, width: 1, height: 560 },
    { left: 1010, top: 100, width: 300, height: 14 },
    { left: 1010, top: 150, width: 260, height: 14 },
    { left: 1010, top: 200, width: 280, height: 14 },
  ];
}

describe("visual-distance · registered ink-mass distance", () => {
  it("scores identical renders 0", async () => {
    const a = await draw(preWave());
    const d = await visualDistance(a, a, VIEWPORT);
    expect(d.ratio).toBe(0);
    expect(d.shift).toEqual({ dx: 0, dy: 0 });
  });

  it("reads a page that merely slid (64px right, 40px down) as LOW distance", async () => {
    const a = await draw(preWave());
    const b = await draw(preWave(64, 40));
    const d = await visualDistance(a, b, VIEWPORT);
    expect(d.ratio, `a translation scored ${d.ratio.toFixed(3)}`).toBeLessThan(0.3);
    // …and it is the registration that absorbs the slide, not a coincidence:
    // with no registration reach the same pair scores markedly higher
    // (measured 0.112 registered vs 0.320 unregistered on this shape).
    const unregistered = gridDistance(await massGrid(a, VIEWPORT), await massGrid(b, VIEWPORT), 0);
    expect(unregistered.ratio).toBeGreaterThan(d.ratio + 0.15);
  });

  it("reads a recomposed page as HIGH distance", async () => {
    const a = await draw(preWave());
    const b = await draw(recomposed());
    const d = await visualDistance(a, b, VIEWPORT);
    expect(d.ratio, `a recomposition scored ${d.ratio.toFixed(3)}`).toBeGreaterThan(0.5);
  });

  it("is symmetric enough to gate in either direction", async () => {
    const a = await draw(preWave());
    const b = await draw(recomposed());
    const ab = await visualDistance(a, b, VIEWPORT);
    const ba = await visualDistance(b, a, VIEWPORT);
    expect(Math.abs(ab.ratio - ba.ratio)).toBeLessThan(0.05);
  });
});
