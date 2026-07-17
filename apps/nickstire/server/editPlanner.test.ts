/**
 * Source-clip analysis (milestone 7 §42) — pure verdict logic pinned, plus a
 * REAL-ffmpeg pass on synthetic clips with KNOWN ground truth (a moving clip
 * and a frozen clip) so the detector is proven, not assumed.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  analyzeSourceClip,
  composeAnalysis,
  meanFromSignalstats,
  parseFreezeSpans,
} from "./services/editPlanner";

describe("parseFreezeSpans", () => {
  it("pairs freeze_start/freeze_end and closes an open span at duration", () => {
    const err = "[freezedetect] lavfi.freezedetect.freeze_start: 1.0\n[freezedetect] lavfi.freezedetect.freeze_end: 2.5\n[freezedetect] lavfi.freezedetect.freeze_start: 3.0\n";
    expect(parseFreezeSpans(err, 4)).toEqual([{ startSec: 1, endSec: 2.5 }, { startSec: 3, endSec: 4 }]);
  });
});

describe("meanFromSignalstats", () => {
  it("averages YAVG values", () => {
    expect(meanFromSignalstats("lavfi.signalstats.YAVG=10.0\nlavfi.signalstats.YAVG=30.0\n")).toBe(20);
  });
  it("no values -> 0", () => {
    expect(meanFromSignalstats("nothing here")).toBe(0);
  });
});

describe("composeAnalysis verdicts", () => {
  it("a clean moving clip is good with a full usable window", () => {
    const a = composeAnalysis({ path: "x", durationSec: 4, frozenSpans: [], meanBrightness: 120 });
    expect(a.verdict).toBe("good");
    expect(a.motionScore).toBe(1);
    expect([a.usableInSec, a.usableOutSec]).toEqual([0, 4]);
  });
  it("a mostly-frozen clip is static", () => {
    const a = composeAnalysis({ path: "x", durationSec: 4, frozenSpans: [{ startSec: 0.5, endSec: 4 }], meanBrightness: 120 });
    expect(a.verdict).toBe("static");
    expect(a.frozenFraction).toBeGreaterThan(0.6);
  });
  it("a dark but moving clip is dark", () => {
    const a = composeAnalysis({ path: "x", durationSec: 4, frozenSpans: [], meanBrightness: 12 });
    expect(a.verdict).toBe("dark");
  });
  it("a fully frozen clip has no usable window and is unusable", () => {
    const a = composeAnalysis({ path: "x", durationSec: 4, frozenSpans: [{ startSec: 0, endSec: 4 }], meanBrightness: 120 });
    expect(a.usableInSec).toBeNull();
    expect(a.verdict).toBe("unusable");
  });
});

// ─── Real detector pass on synthetic ground truth ───────────────────
const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = spawnSync(ffmpegBin, ["-version"], { encoding: "utf8", shell: process.platform === "win32" }).status === 0;
let dir: string | null = null;
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(!hasFfmpeg)("analyzeSourceClip on known clips", () => {
  it("distinguishes a MOVING clip from a FROZEN clip", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "editplan-"));
    const ff = (a: string[]) => spawnSync(ffmpegBin, a, { cwd: dir!, encoding: "utf8", shell: process.platform === "win32", timeout: 60_000 });
    const moving = path.join(dir, "moving.mp4");
    const frozen = path.join(dir, "frozen.mp4");
    // testsrc animates; a single solid color held for 4s is frozen.
    expect(ff(["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=270x480:rate=30:duration=4", "-pix_fmt", "yuv420p", moving]).status).toBe(0);
    expect(ff(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=gray:size=270x480:rate=30:duration=4", "-pix_fmt", "yuv420p", frozen]).status).toBe(0);

    const mv = await analyzeSourceClip(moving);
    const fz = await analyzeSourceClip(frozen);

    expect(mv.motionScore).toBeGreaterThan(fz.motionScore);
    expect(mv.frozenFraction).toBeLessThan(0.5);
    expect(fz.frozenFraction).toBeGreaterThan(0.5);
    expect(mv.verdict).toBe("good");
    expect(["static", "unusable"]).toContain(fz.verdict);
  }, 90_000);
});
