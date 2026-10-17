/**
 * Two-pass loudnorm (deep scout 2026-10-17 #10).
 *
 * Pass 1 measures the mixed track (loudnorm print_format=json on a null output);
 * pass 2 applies loudnorm with the measured values and linear=true, so the gain is
 * one linear move instead of single-pass dynamic mode with its limiter. A failed
 * or unparseable measure falls back to today's single-pass filter; it never fails
 * the render. The helpers live in services/audioQa.ts (reelAssembly imports them);
 * the measure args and the parser are reached through measureMixLoudness with a
 * capturing runner, so no ffmpeg is needed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { briefToSegments, buildFfmpegArgs, type ReelAssemblyBrief } from "./services/reelAssembly";
import { loudnormFilter, measureMixLoudness } from "./services/audioQa";

/** Recorded tail of `ffmpeg ... -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null -` (ffmpeg 6/7 layout). */
const RECORDED = `size=N/A time=00:00:15.00 bitrate=N/A speed= 152x
[Parsed_loudnorm_9 @ 0000021f3c5a1b40]
{
	"input_i" : "-19.84",
	"input_tp" : "-3.12",
	"input_lra" : "6.40",
	"input_thresh" : "-30.02",
	"output_i" : "-14.21",
	"output_tp" : "-1.50",
	"output_lra" : "5.10",
	"output_thresh" : "-24.33",
	"normalization_type" : "dynamic",
	"target_offset" : "0.21"
}
`;
const MEASURED = { input_i: "-19.84", input_tp: "-3.12", input_lra: "6.40", input_thresh: "-30.02", target_offset: "0.21" };
const SINGLE = "loudnorm=I=-14:TP=-1.5:LRA=11";

const BRIEF: ReelAssemblyBrief = {
  id: "b1",
  voiceoverScript: "Something is stealing your air.",
  storyboardBeats: [
    { beatNumber: 1, startSecond: 0, endSecond: 2, onScreenText: "One", visual: "x" },
    { beatNumber: 2, startSecond: 2, endSecond: 5, onScreenText: "Two", visual: "x" },
  ],
} as ReelAssemblyBrief;
const base = {
  segs: briefToSegments(BRIEF),
  clipPaths: ["/t/c1.mp4", "/t/c2.mp4"],
  voPath: "/t/vo.wav",
  musicPath: "/t/music.mp3",
  fontPath: "font.ttf",
  outPath: "/t/out.mp4",
  askText: null,
};
/** The render's own -t value: beats plus the SAVE freeze. The measure pass must use the same length. */
const renderTotal = () => {
  const a = buildFfmpegArgs(base);
  return Number(a[a.indexOf("-t") + 1]);
};
const measureIn = (o: { voPath?: string | null; musicPath?: string | null } = {}) => ({ voPath: base.voPath, musicPath: base.musicPath, videoTotal: renderTotal(), ...o });
/** A runner that records the args it was given and answers with `stderr`. */
const recorder = (stderr: string) => {
  const calls: string[][] = [];
  return { calls, run: async (args: string[]) => (calls.push(args), stderr) };
};

describe("measureMixLoudness parses the first pass", () => {
  it("reads the five measured values from a recorded loudnorm JSON block", async () => {
    expect(await measureMixLoudness(measureIn(), recorder(RECORDED).run)).toEqual(MEASURED);
  });

  it("garbage, a missing field, a non-finite value (silence reads -inf) or broken JSON is null (single pass)", async () => {
    for (const stderr of ["ffmpeg exited 1: no such file", RECORDED.replace(/\s*"target_offset" : "0.21"/, ""), RECORDED.replace('"-19.84"', '"-inf"'), "{ broken json"]) {
      expect(await measureMixLoudness(measureIn(), recorder(stderr).run)).toBeNull();
    }
  });

  it("a throwing runner is null, never a failed render", async () => {
    expect(await measureMixLoudness(measureIn(), async () => { throw new Error("ffmpeg exited 1"); })).toBeNull();
  });

  it("no audio -> null without running ffmpeg", async () => {
    const r = recorder(RECORDED);
    expect(await measureMixLoudness(measureIn({ voPath: null, musicPath: null }), r.run)).toBeNull();
    expect(r.calls).toHaveLength(0);
  });
});

describe("the first pass measures the SAME mix the render plays", () => {
  it("audio inputs only, the render's duck/mix chain re-indexed, print_format=json to a null output", async () => {
    const r = recorder(RECORDED);
    await measureMixLoudness(measureIn(), r.run);
    const args = r.calls[0];
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(args).toContain("/t/vo.wav");
    expect(args).toContain("/t/music.mp3");
    expect(args).not.toContain("/t/c1.mp4");
    const fc = args[args.indexOf("-filter_complex") + 1];
    const render = buildFfmpegArgs(base);
    const renderAudio = render[render.indexOf("-filter_complex") + 1].split(";").filter((l) => /^\[(2:a|3:a|vo_|mus_|am\])/.test(l));
    expect(renderAudio).toHaveLength(6);
    const expected = renderAudio.join(";").replace(/\[2:a\]/g, "[0:a]").replace(/\[3:a\]/g, "[1:a]").replace(`${SINGLE},aresample=48000[aout]`, `${SINGLE}:print_format=json[aout]`);
    expect(fc).toBe(expected);
    expect(args.slice(-3)).toEqual(["-f", "null", "-"]);
  });

  it("VO only and music only measure from input 0", async () => {
    for (const o of [{ musicPath: null }, { voPath: null }]) {
      const r = recorder(RECORDED);
      await measureMixLoudness(measureIn(o), r.run);
      expect(r.calls[0].filter((a) => a === "-i")).toHaveLength(1);
      expect(r.calls[0][r.calls[0].indexOf("-filter_complex") + 1]).toMatch(/^\[0:a\]/);
    }
  });
});

describe("loudnormFilter", () => {
  it("measured -> second pass with measured_* and linear=true at the same target", () => {
    expect(loudnormFilter(MEASURED)).toBe(
      "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-19.84:measured_TP=-3.12:measured_LRA=6.40:measured_thresh=-30.02:offset=0.21:linear=true",
    );
  });
  it("no measurement -> today's single-pass filter, byte for byte", () => {
    expect(loudnormFilter(null)).toBe(SINGLE);
    expect(loudnormFilter(undefined)).toBe(SINGLE);
  });
});

describe("buildFfmpegArgs carries the second pass into every audio branch", () => {
  it("VO + music, VO only, music only", () => {
    for (const opts of [base, { ...base, musicPath: null }, { ...base, voPath: null }]) {
      const fc = buildFfmpegArgs({ ...opts, loudnorm: MEASURED }).join(" ");
      expect(fc).toContain(`${loudnormFilter(MEASURED)},aresample=48000[aout]`);
    }
  });
  it("without a measurement the graph is unchanged (single pass, no measured_)", () => {
    const fc = buildFfmpegArgs(base).join(" ");
    expect(fc).toContain(`${SINGLE},aresample=48000[aout]`);
    expect(fc).not.toContain("measured_");
  });
});

describe("assembleReel wiring", () => {
  it("measures the mix at the render's length and hands the result to the render args", () => {
    const src = readFileSync(path.join(__dirname, "services", "reelAssembly.ts"), "utf8");
    const call = src.indexOf("const args = buildFfmpegArgs({ segs, clipPaths, voPath, assPath, musicPath, fontPath: \"font.ttf\", outPath, askText, loudnorm");
    expect(call).toBeGreaterThan(-1);
    const measure = src.lastIndexOf("await measureMixLoudness(", call);
    expect(measure).toBeGreaterThan(-1);
    expect(src.slice(measure, call)).toContain("videoTotal: renderVideoTotal(segs)");
    expect(src).toMatch(/import \{[^}]*measureMixLoudness[^}]*\} from "\.\/audioQa"/);
  });
});
