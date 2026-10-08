import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { flashRiskFromLuma, scanFlashRisk, FLASH_SAMPLE_FPS } from "./flashRisk";

const fps = FLASH_SAMPLE_FPS;
const secs = (n: number, f: (t: number) => number) => Array.from({ length: Math.round(n * fps) }, (_, i) => f(i / fps));

describe("flashRiskFromLuma — WCAG 2.3.1 general flash, whole-frame proxy", () => {
  it("a steady frame never flashes", () => {
    expect(flashRiskFromLuma(secs(3, () => 120))).toMatchObject({ maxFlashesPerSecond: 0, fail: false });
  });

  it("a 5 Hz black/white strobe fails (5 flashes a second)", () => {
    const r = flashRiskFromLuma(secs(3, (t) => (Math.floor(t * 10) % 2 ? 235 : 16)));
    expect(r.fail).toBe(true);
    expect(r.maxFlashesPerSecond).toBeGreaterThan(3);
  });

  it("two flashes a second pass", () => {
    const r = flashRiskFromLuma(secs(4, (t) => (Math.floor(t * 4) % 2 ? 235 : 16)));
    expect(r.fail).toBe(false);
    expect(r.maxFlashesPerSecond).toBeLessThanOrEqual(3);
  });

  it("one white-flash transition between beats passes", () => {
    const r = flashRiskFromLuma(secs(4, (t) => (t > 2 && t < 2.15 ? 235 : 60)));
    expect(r).toMatchObject({ maxFlashesPerSecond: 1, fail: false });
  });

  it("a slow fade is not a flash, however deep", () => {
    expect(flashRiskFromLuma(secs(4, (t) => 16 + (219 * t) / 4)).maxFlashesPerSecond).toBe(0);
  });

  it("changes between two bright states (darker state >= 0.8) are not general flashes", () => {
    expect(flashRiskFromLuma(secs(3, (t) => (Math.floor(t * 10) % 2 ? 255 : 240))).fail).toBe(false);
  });
});

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" }).status === 0;

describe.skipIf(!hasFfmpeg)("scanFlashRisk — the real ffmpeg pass", () => {
  const render = (dir: string, name: string, lumExpr: string) => {
    const out = path.join(dir, name);
    const res = spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", `color=c=black:s=64x64:r=30:d=3,format=yuv420p,geq=lum='${lumExpr}':cb=128:cr=128`, "-c:v", "libx264", "-pix_fmt", "yuv420p", out], { encoding: "utf8" });
    expect(res.status, res.stderr?.slice(-300)).toBe(0);
    return out;
  };

  it("fails a rendered 5 Hz strobe and passes a rendered steady clip", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flash-"));
    try {
      const strobe = await scanFlashRisk(render(dir, "strobe.mp4", "if(mod(floor(N/3),2),235,16)"));
      expect(strobe.fail).toBe(true);
      const steady = await scanFlashRisk(render(dir, "steady.mp4", "120"));
      expect(steady).toMatchObject({ fail: false, maxFlashesPerSecond: 0 });
      expect(steady.framesAnalysed).toBeGreaterThan(30);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
