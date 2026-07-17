/**
 * Audio QA (milestone 8 §58) — pure verdict logic pinned + a REAL ffmpeg pass
 * on a synthesized reel-like file with known-good audio, plus a mono file the
 * gate must flag. Proves "poor audio must not pass" on measured facts.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  AUDIO_DELIVERY,
  composeAudioVerdict,
  detectClipping,
  parseLoudnorm,
  runAudioQa,
} from "./services/audioQa";

describe("parseLoudnorm", () => {
  it("reads integrated LUFS and true peak from the JSON block", () => {
    const err = 'stuff\n{\n"input_i" : "-14.63",\n"input_tp" : "-1.45",\n"input_lra" : "5.1"\n}\n';
    expect(parseLoudnorm(err)).toEqual({ integratedLufs: -14.63, truePeakDb: -1.45 });
  });
});

describe("detectClipping", () => {
  it("flags a 0 dBFS peak as clipping; -inf (silence) and headroom are clean", () => {
    expect(detectClipping("Peak level dB: 0.000000")).toBe(true);
    expect(detectClipping("Peak level dB: -inf")).toBe(false); // -inf = pure silence, not clipping
    expect(detectClipping("Peak level dB: -3.2")).toBe(false);
  });
});

describe("composeAudioVerdict", () => {
  it("approves on-target stereo audio", () => {
    const v = composeAudioVerdict({ hasAudio: true, integratedLufs: -14, truePeakDb: -1.5, channels: 2, sampleRate: 48000, clipping: false });
    expect(v.decision).toBe("approve");
    expect(v.findings).toEqual([]);
  });
  it("REPAIRS the published baseline's mono+quiet shape (would have caught it)", () => {
    // The baseline reel: mono, and had it also drifted loud/peaky the gate fires.
    const v = composeAudioVerdict({ hasAudio: true, integratedLufs: -8, truePeakDb: 0.5, channels: 1, sampleRate: 48000, clipping: true });
    expect(v.decision).toBe("repair");
    expect(v.findings.join(" ")).toMatch(/loudness/);
    expect(v.findings.join(" ")).toMatch(/true peak/);
    expect(v.findings.join(" ")).toMatch(/clipping/);
    expect(v.findings.join(" ")).toMatch(/mono/);
  });
  it("no audio stream forces repair", () => {
    expect(composeAudioVerdict({ hasAudio: false, integratedLufs: null, truePeakDb: null, channels: null, sampleRate: null, clipping: false }).decision).toBe("repair");
  });
  it("mono ALONE is a warning, not a hard repair (stereo is the norm, not a blocker)", () => {
    const v = composeAudioVerdict({ hasAudio: true, integratedLufs: -14, truePeakDb: -1.5, channels: 1, sampleRate: 48000, clipping: false });
    expect(v.decision).toBe("approve");
    expect(v.findings.join(" ")).toMatch(/mono/);
  });
  it("delivery targets are sane (IG Reels band)", () => {
    expect(AUDIO_DELIVERY.integratedLufsMin).toBeLessThan(AUDIO_DELIVERY.integratedLufsMax);
    expect(AUDIO_DELIVERY.truePeakMaxDb).toBeLessThanOrEqual(-1);
  });
});

// ─── Real ffmpeg pass ───────────────────────────────────────────────
const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = spawnSync(ffmpegBin, ["-version"], { encoding: "utf8", shell: process.platform === "win32" }).status === 0;
let dir: string | null = null;
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(!hasFfmpeg)("runAudioQa on real audio", () => {
  it("measures a normalized stereo file: approves; and flags a mono file as a warning", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "audioqa-"));
    const ff = (a: string[]) => spawnSync(ffmpegBin, a, { cwd: dir!, encoding: "utf8", shell: process.platform === "win32", timeout: 90_000 });
    const stereo = path.join(dir, "stereo.mp4");
    const mono = path.join(dir, "mono.mp4");
    // a tone normalized toward the target band, stereo, over a black frame.
    // -ac 2 + loudnorm keeps the filter chain single-stream-simple.
    const g = ff(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=270x480:r=30:d=3", "-f", "lavfi", "-i", "sine=f=220:d=3:sample_rate=48000", "-af", "loudnorm=I=-14:TP=-1.5", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-shortest", "-pix_fmt", "yuv420p", stereo]);
    expect(g.status, (g.stderr || "").slice(-300)).toBe(0);
    const gm = ff(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=270x480:r=30:d=3", "-f", "lavfi", "-i", "sine=f=220:d=3:sample_rate=48000", "-af", "loudnorm=I=-14:TP=-1.5", "-ac", "1", "-c:a", "aac", "-b:a", "64k", "-shortest", "-pix_fmt", "yuv420p", mono]);
    expect(gm.status, (gm.stderr || "").slice(-300)).toBe(0);

    const s = await runAudioQa(stereo);
    expect(s.hasAudio).toBe(true);
    expect(s.channels).toBe(2);
    expect(s.decision).toBe("approve");

    const m = await runAudioQa(mono);
    expect(m.channels).toBe(1);
    expect(m.findings.join(" ")).toMatch(/mono/);
  }, 120_000);
});
