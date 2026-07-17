/**
 * Dead-air gate + audio-graph length fixes.
 *
 * The published reel (job 30008) shipped silent from 7.1s to 22.0s: the
 * sidechaincompress KEY (the VO) ended at 7.1s, which terminates the filter's
 * output, truncating the ducked music — then apad filled the remainder with
 * digital silence. No string-level graph test could see that; the real-render
 * trajectory test at the bottom exists precisely because of it.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildFfmpegArgs,
  briefToSegments,
  evaluateAudioIntegrity,
  parseSilencedetect,
  SAVE_FREEZE_SECONDS,
} from "./services/reelAssembly";

const BRIEF = {
  storyboardBeats: [
    { beatNumber: 1, startSecond: 0, endSecond: 3, onScreenText: "HOOK", visual: "a" },
    { beatNumber: 2, startSecond: 3, endSecond: 6, onScreenText: "BODY", visual: "b" },
  ],
};

// Real shape of ffmpeg silencedetect stderr, including the progress noise the
// parser must ignore (taken from the actual baseline measurement of 30008).
const REAL_STDERR = [
  "[Parsed_silencedetect_0 @ 0000022e454a0f40] silence_start: 7.122042",
  "frame=  499 fps=0.0 q=-0.0 size=N/A time=00:00:16.63 bitrate=N/A speed=32.3x",
  "[Parsed_silencedetect_0 @ 0000022e454a0f40] silence_end: 22.016 | silence_duration: 14.893958",
].join("\n");

describe("parseSilencedetect", () => {
  it("parses gaps out of real stderr with progress noise interleaved", () => {
    expect(parseSilencedetect(REAL_STDERR, 22)).toEqual([{ start: 7.122042, end: 22.016 }]);
  });

  it("an unterminated silence_start (file ends silent) closes at the file duration", () => {
    const gaps = parseSilencedetect("[silencedetect] silence_start: 5.0\n", 20);
    expect(gaps).toEqual([{ start: 5, end: 20 }]);
  });
});

describe("evaluateAudioIntegrity", () => {
  it("REFUSES the exact published dead-air case (silent 7.1s -> 22.0s of 22s)", () => {
    const verdict = evaluateAudioIntegrity({ gaps: parseSilencedetect(REAL_STDERR, 22), durationSec: 22 });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons[0]).toMatch(/dead air: silent from 7\.12s to 22\.02s/);
  });

  it("tolerates short mid-gaps and a brief tail into the freeze frame", () => {
    const verdict = evaluateAudioIntegrity({
      gaps: [
        { start: 4.0, end: 5.2 },   // 1.2s breath — fine
        { start: 21.5, end: 22.0 }, // 0.5s tail — fine
      ],
      durationSec: 22,
    });
    expect(verdict).toEqual({ ok: true, reasons: [] });
  });
});

describe("audio graph length fixes (string level)", () => {
  const segs = briefToSegments(BRIEF);
  const base = {
    segs,
    clipPaths: ["/t/c1.mp4", "/t/c2.mp4"],
    voPath: "/t/vo.wav",
    musicPath: "/t/music.mp3",
    fontPath: "/f/font.ttf",
    outPath: "/t/out.mp4",
  };

  it("pads the sidechain KEY to the full timeline — the truncation that caused the published dead air", () => {
    const fc = buildFfmpegArgs(base).join(" ");
    expect(fc).toMatch(/\[vo_key\]apad=whole_dur=\d+(\.\d+)?\[vo_key_p\]/);
    expect(fc).toContain("[mus_raw][vo_key_p]sidechaincompress");
  });

  it("loops the music bed so any bed length covers any legal reel length", () => {
    const fc = buildFfmpegArgs(base).join(" ");
    expect(fc).toContain("aloop=loop=-1");
    const musicOnly = buildFfmpegArgs({ ...base, voPath: null }).join(" ");
    expect(musicOnly).toContain("aloop=loop=-1");
  });

  it("encodes stereo audio (published master was mono)", () => {
    const args = buildFfmpegArgs(base);
    const ac = args.indexOf("-ac");
    expect(ac).toBeGreaterThan(-1);
    expect(args[ac + 1]).toBe("2");
  });
});

// ─── Real-render trajectory ─────────────────────────────────────────
// Runs the ACTUAL graph through the real ffmpeg with a 2s VO, a 4s music bed,
// and a ~9s timeline — the exact shape that used to produce dead air (short
// key AND short bed). Skipped where ffmpeg or a system font is unavailable.

const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = spawnSync(ffmpegBin, ["-version"], { encoding: "utf8", shell: process.platform === "win32" }).status === 0;
const fontCandidates = [
  "C:\\Windows\\Fonts\\arialbd.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
];
const systemFont = fontCandidates.find((f) => fs.existsSync(f));
let workDir: string | null = null;

afterAll(() => {
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

describe.skipIf(!hasFfmpeg || !systemFont)("real-render dead-air trajectory", () => {
  it("a short VO + a shorter-than-reel bed renders with NO dead air (music breathes back in and loops)", () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-audio-"));
    const ff = (args: string[]) =>
      spawnSync(ffmpegBin, args, { cwd: workDir!, encoding: "utf8", shell: process.platform === "win32", timeout: 90_000 });

    // Inputs: two 3s clips, a 2s speech-band VO, a 4s bed (shorter than the reel)
    expect(ff(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=darkslategray:s=270x480:d=3:r=30", "-pix_fmt", "yuv420p", "c1.mp4"]).status).toBe(0);
    expect(ff(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=goldenrod:s=270x480:d=3:r=30", "-pix_fmt", "yuv420p", "c2.mp4"]).status).toBe(0);
    expect(ff(["-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=300:d=2", "vo.wav"]).status).toBe(0);
    expect(ff(["-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=110:d=4", "-b:a", "96k", "music.mp3"]).status).toBe(0);
    fs.copyFileSync(systemFont!, path.join(workDir, "font.ttf"));
    fs.writeFileSync(path.join(workDir, "caption_0_0.txt"), "HOOK");
    fs.writeFileSync(path.join(workDir, "caption_1_0.txt"), "BODY");
    fs.writeFileSync(path.join(workDir, "caption_save.txt"), "SAVE THIS");

    const segs = briefToSegments(BRIEF); // 6s of beats + 3s freeze = 9s timeline
    const args = buildFfmpegArgs({
      segs,
      clipPaths: ["c1.mp4", "c2.mp4"],
      voPath: "vo.wav",
      musicPath: "music.mp3",
      fontPath: "font.ttf",
      outPath: "out.mp4",
    });
    const render = ff(args);
    expect(render.status, (render.stderr || "").slice(-500)).toBe(0);

    const durationSec = segs.reduce((a, s) => a + s.dur, 0) + SAVE_FREEZE_SECONDS;
    const detect = ff(["-i", "out.mp4", "-af", "silencedetect=n=-35dB:d=1.0", "-f", "null", "-"]);
    const gaps = parseSilencedetect(detect.stderr ?? "", durationSec);
    const verdict = evaluateAudioIntegrity({ gaps, durationSec });
    expect(verdict.reasons, `gaps found: ${JSON.stringify(gaps)}`).toEqual([]);

    // and the encode is stereo now
    const probe = spawnSync(process.env.FFPROBE_PATH || "ffprobe", ["-v", "quiet", "-show_entries", "stream=channels", "-select_streams", "a", "-of", "csv=p=0", "out.mp4"], { cwd: workDir!, encoding: "utf8", shell: process.platform === "win32" });
    expect((probe.stdout ?? "").trim()).toBe("2");
  }, 120_000);
});
