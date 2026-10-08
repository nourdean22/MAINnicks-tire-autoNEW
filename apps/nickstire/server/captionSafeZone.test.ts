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
  CAPTION_BEAT_Y_FRAC,
  CAPTION_SAFE,
  buildFfmpegArgs,
  capFontSizeToSafeWidth,
  captionFontSize,
  estimateCaptionWidthPx,
  resolveReelFontPath,
  sanitizeCaption,
  wrapCaption,
} from "./services/reelAssembly";
import { generateAssSubtitles } from "./services/reelVoice";

/** MarginV of the Default style, read from the generated subtitles (field 22 of a V4+ Style line). */
function assMarginV(ass: string): number {
  const style = ass.split("\n").find((l) => l.startsWith("Style: Default,"));
  expect(style, "the generated ASS has a Default style").toBeTruthy();
  return Number(style!.slice("Style: ".length).split(",")[21]);
}
const sampleAss = () =>
  generateAssSubtitles({ characters: [..."ONE EDGE"], characterStartTimesSeconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], characterEndTimesSeconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] });

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
// box on a black frame) and measure the rendered box with cropdetect.
//
// The face is production's own Anton (byte-identical to adAssets'
// ANTON_TTF_B64, which resolveReelFontPath() writes out). It used to be Arial
// Bold on Windows or DejaVu Sans Bold on Linux, as a "wider, so conservative"
// stand-in. DejaVu is wider than the 0.58em advance model allows: 936 px
// against an 894 px budget, on every Linux box with ffmpeg (2026-10-08), for
// a face no Reel renders in. The stand-ins remain only as fallbacks.

const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = spawnSync(ffmpegBin, ["-version"], { encoding: "utf8", shell: process.platform === "win32" }).status === 0;
const font = [
  path.join(__dirname, "services", "adStudio", "fonts", "Anton-Regular.ttf"),
  "C:\\Windows\\Fonts\\arialbd.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
].find((f) => fs.existsSync(f));
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

// ─── Instagram's bottom 35% (2026-10-08) ────────────────────────────
// Meta's safe-zone guide: nothing essential below 65% of a Reel's height —
// Instagram's caption, username, audio ticker and buttons sit there. Beat
// captions anchored at 0.62 ended inside it (one line by 18-26 px, two lines
// by up to 103 px, measured with Anton), and the word-timed ASS captions sat
// wholly inside it (69.5-74.2% of the height).
const FRAME_H = 1920;
const RESERVE_TOP = Math.round(FRAME_H * 0.65); // 1248
const BANDS = [64, 56, 50, 44] as const; // captionFontSize's bands

describe("beat captions end above Instagram's bottom 35% (arithmetic, runs everywhere)", () => {
  // Conservative: the glyph box counted as the full font size, plus drawtext's 28 px box border.
  const boxBottom = (frac: number, lines: number, size: number) =>
    Math.round(FRAME_H * frac) + (lines - 1) * Math.round(size * 1.2) + size + 28;

  it("every font band, one line or two", () => {
    for (const size of BANDS) {
      for (const lines of [1, 2]) {
        expect(boxBottom(CAPTION_BEAT_Y_FRAC, lines, size), `${lines} line(s) at ${size}px`).toBeLessThan(RESERVE_TOP);
      }
    }
  });

  it("CONTROL: the old 0.62 anchor fails the same arithmetic", () => {
    expect(boxBottom(0.62, 1, 64)).toBeGreaterThanOrEqual(RESERVE_TOP);
  });

  it("the model matches the real filter: 28 px box border, 1.2 line height, the exported anchor", () => {
    const fc = buildFfmpegArgs({
      segs: [
        { beatNumber: 1, dur: 4, caption: "HOOK LINE", fontSize: 64 },
        { beatNumber: 2, dur: 4, caption: "CHECK THE INNER EDGE\nBEFORE IT CORDS", fontSize: 56 },
      ],
      clipPaths: ["a.mp4", "b.mp4"], voPath: null, musicPath: null, assPath: null, fontPath: "font.ttf", outPath: "out.mp4", askText: null,
    }).join(" ");
    expect(fc).toContain("boxborderw=28");
    expect(fc).toContain(`y=h*${CAPTION_BEAT_Y_FRAC}+0`);
    expect(fc).toContain(`y=h*${CAPTION_BEAT_Y_FRAC}+${Math.round(56 * 1.2)}`);
  });

  it("the word-timed ASS captions: bottom edge (height - MarginV, plus the 6 px box) above the reserve", () => {
    const marginV = assMarginV(sampleAss());
    expect(FRAME_H - marginV + 6).toBeLessThan(RESERVE_TOP);
    expect(FRAME_H - 500 + 6).toBeGreaterThanOrEqual(RESERVE_TOP); // CONTROL: the old margin
    expect(sampleAss()).toContain(",2,20,20,"); // bottom-centre alignment, so a wrapped chunk grows upward
  });
});

/** Render one 1080x1920 frame over white and return the caption's first and last non-white rows. */
function captionRows(vf: string, cwd: string): { top: number; bottom: number } {
  const res = spawnSync(
    ffmpegBin,
    ["-v", "error", "-f", "lavfi", "-i", "color=white:s=1080x1920:d=1", "-vf", `${vf},format=gray`, "-ss", "0.5", "-frames:v", "1", "-f", "rawvideo", "-"],
    { cwd, shell: process.platform === "win32", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
  expect(res.status, String(res.stderr ?? "").slice(-400)).toBe(0);
  const raw = res.stdout as Buffer;
  expect(raw.length).toBe(1080 * FRAME_H);
  const rows: number[] = [];
  for (let y = 0; y < FRAME_H; y++) {
    let min = 255;
    for (let x = 0; x < 1080; x++) min = Math.min(min, raw[y * 1080 + x]);
    if (min < 250) rows.push(y);
  }
  expect(rows.length, "the caption rendered").toBeGreaterThan(20);
  return { top: rows[0], bottom: rows[rows.length - 1] };
}

// Each render needs a specific filter (drawtext needs libfreetype, subtitles needs
// libass); a build without one skips that test rather than failing for the build.
const ffmpegFilters = hasFfmpeg
  ? String(spawnSync(ffmpegBin, ["-hide_banner", "-filters"], { encoding: "utf8", shell: process.platform === "win32" }).stdout ?? "")
  : "";
const hasDrawtext = /\bdrawtext\b/.test(ffmpegFilters);
const hasLibass = /\bsubtitles\b/.test(ffmpegFilters);

describe("rendered with the production font: captions end above the bottom 35%", () => {
  let work: string;
  const lines2: Record<number, string[]> = {
    64: ["ONE EDGE WORN", "IS A CLUE"],
    56: ["CHECK THE INNER EDGE", "BEFORE IT CORDS"],
    50: ["WE LOOK INSIDE FIRST,", "THEN WE DECIDE"],
    44: ["SHOULDER DAMAGE MEANS REPLACE", "NOT A PATCH"],
  };
  const drawtext = (frac: number, lines: string[], size: number) =>
    lines.map((line, j) => {
      fs.writeFileSync(path.join(work, `cap_${j}.txt`), line);
      return `drawtext=fontfile='font.ttf':textfile='cap_${j}.txt':fontsize=${size}:fontcolor=0xFDB913:borderw=6:bordercolor=black:box=1:boxcolor=black@0.6:boxborderw=28:x=(w-text_w)/2:y=h*${frac}+${j * Math.round(size * 1.2)}`;
    }).join(",");

  it.skipIf(!hasDrawtext)("drawtext beat captions, every band, one line and two (Anton)", async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "caption-reserve-"));
    try {
      fs.copyFileSync(await resolveReelFontPath(), path.join(work, "font.ttf"));
      for (const size of BANDS) {
        for (const lines of [lines2[size].slice(0, 1), lines2[size]]) {
          const { bottom } = captionRows(drawtext(CAPTION_BEAT_Y_FRAC, lines, size), work);
          expect(bottom, `${lines.length} line(s) at ${size}px ends at ${(bottom / FRAME_H).toFixed(3)}`).toBeLessThan(RESERVE_TOP);
        }
      }
      // POSITIVE CONTROL: the same measurement sees the old anchor's intrusion.
      expect(captionRows(drawtext(0.62, lines2[64], 64), work).bottom).toBeGreaterThanOrEqual(RESERVE_TOP);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }, 120_000);

  it.skipIf(!hasLibass)("word-timed ASS captions through libass (Anton)", async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "caption-reserve-ass-"));
    try {
      fs.mkdirSync(path.join(work, "fonts"));
      fs.copyFileSync(await resolveReelFontPath(), path.join(work, "fonts", "Anton.ttf"));
      // One word per second, so exactly one dialogue line is on screen at t=0.5
      // (overlapping windows would make libass stack lines, which real timing never does).
      const chars = [..."Misalignment accelerates shoulder-scrubbing"];
      let word = 0;
      const wordOf = chars.map((c) => (c === " " ? word++ : word));
      const ass = generateAssSubtitles({
        characters: chars,
        characterStartTimesSeconds: wordOf.map((w) => w),
        characterEndTimesSeconds: wordOf.map((w) => w + 0.99),
      });
      fs.writeFileSync(path.join(work, "now.ass"), ass);
      fs.writeFileSync(path.join(work, "old.ass"), ass.replace(`,2,20,20,${assMarginV(ass)},1`, ",2,20,20,500,1"));
      expect(captionRows("subtitles=now.ass:fontsdir=fonts", work).bottom).toBeLessThan(RESERVE_TOP);
      // POSITIVE CONTROL: the old margin put the whole caption inside the reserve.
      expect(captionRows("subtitles=old.ass:fontsdir=fonts", work).top).toBeGreaterThanOrEqual(RESERVE_TOP);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }, 120_000);
});
