/**
 * Caption safe-zone (caption-safezone-001) — the published reel's hook ran
 * edge-to-edge; the width cap makes overflow impossible down to the floor.
 * The last test measures REAL rendered pixels (drawtext -> cropdetect), not
 * just the estimate model.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CAPTION_SAFE,
  capFontSizeToSafeWidth,
  captionFontSize,
  estimateCaptionWidthPx,
  sanitizeCaption,
  wrapCaption,
} from "./services/reelAssembly";

const SAFE_PX = CAPTION_SAFE.frameW * CAPTION_SAFE.maxWidthFrac; // 885.6

describe("capFontSizeToSafeWidth", () => {
  it("caps the previously-overflowing case: a 28-char hook line at 50x1.35", () => {
    const line = "A".repeat(28);
    const proposed = Math.round(50 * 1.35); // 68 — estimated ~1153px, wider than the frame
    expect(estimateCaptionWidthPx(line, proposed)).toBeGreaterThan(CAPTION_SAFE.frameW);
    const capped = capFontSizeToSafeWidth(line, proposed);
    expect(capped).toBeLessThan(proposed);
    expect(estimateCaptionWidthPx(line, capped)).toBeLessThanOrEqual(SAFE_PX);
  });

  it("leaves short punchy hooks alone (14 chars at 86 already fits)", () => {
    const line = "POTHOLE SEASON"; // 14 chars
    expect(capFontSizeToSafeWidth(line, 86)).toBe(86);
  });

  it("floors at minFontPx for pathological unbroken lines and logs rather than shrinking to unreadable", () => {
    const line = "W".repeat(60);
    expect(capFontSizeToSafeWidth(line, 64)).toBe(CAPTION_SAFE.minFontPx);
  });

  it("the critique's exact caption survives the full pipeline: apostrophes intact, two lines, fits safe width", () => {
    const raw = "Sidewall = the tire's MAX. Not your car's setting.";
    const caption = wrapCaption(sanitizeCaption(raw));
    expect(caption).toContain("TIRE'S"); // apostrophe preserved (2026-07-16 fix)
    expect(caption.split("\n").length).toBe(2);
    const size = capFontSizeToSafeWidth(caption, Math.round(captionFontSize(caption) * 1.35));
    expect(estimateCaptionWidthPx(caption, size)).toBeLessThanOrEqual(SAFE_PX);
  });
});

// ─── Real-pixel verification ────────────────────────────────────────
// Render the wrapped caption with the REAL drawtext parameters (solid white
// box on a black frame) and measure the rendered box with cropdetect. Arial
// Bold is WIDER than the production Anton-style face, so passing here is the
// conservative case for the 0.58em advance model.

const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = spawnSync(ffmpegBin, ["-version"], { encoding: "utf8", shell: process.platform === "win32" }).status === 0;
const font = ["C:\\Windows\\Fonts\\arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"].find((f) => fs.existsSync(f));
let dir: string | null = null;
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(!hasFfmpeg || !font)("rendered caption pixels stay inside the safe zone", () => {
  it("cropdetect measures the real drawtext box within 82% width + margins", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "caption-safe-"));
    fs.copyFileSync(font!, path.join(dir, "font.ttf"));
    const caption = wrapCaption(sanitizeCaption("Sidewall = the tire's MAX. Not your car's setting."));
    fs.writeFileSync(path.join(dir, "caption_0.txt"), caption);
    const size = capFontSizeToSafeWidth(caption, Math.round(captionFontSize(caption) * 1.35));

    // cropdetect's default skip=2 ignores the first frames — skip=0 + 2 frames
    const draw = `drawtext=fontfile='font.ttf':textfile='caption_0.txt':fontsize=${size}:fontcolor=white:box=1:boxcolor=white:boxborderw=28:x=(w-text_w)/2:y=(h-text_h)/2`;
    const res = spawnSync(
      ffmpegBin,
      ["-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=2:r=1", "-vf", `${draw},cropdetect=limit=24:round=2:skip=0`, "-frames:v", "2", "-f", "null", "-"],
      { cwd: dir, encoding: "utf8", shell: process.platform === "win32", timeout: 60_000 },
    );
    expect(res.status, (res.stderr || "").slice(-400)).toBe(0);
    const crops = [...(res.stderr ?? "").matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
    expect(crops.length).toBeGreaterThan(0);
    const [, w, , x] = crops[crops.length - 1].map(Number);
    // real rendered box: within the 82% budget (small tolerance for round=2)
    expect(w).toBeLessThanOrEqual(Math.round(CAPTION_SAFE.frameW * CAPTION_SAFE.maxWidthFrac) + 8);
    // and actually centered with real margins on both sides
    expect(x).toBeGreaterThanOrEqual(Math.floor((CAPTION_SAFE.frameW - w) / 2) - 8);
    expect(w).toBeGreaterThan(300); // sanity: the box is really there
  }, 90_000);
});
