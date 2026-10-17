/**
 * Two-pass loudnorm (deep scout 2026-10-17 #10).
 *
 * Pass 1 measures the mixed track (loudnorm print_format=json on a null output);
 * pass 2 applies loudnorm with the measured values and linear=true, so the gain is
 * one linear move instead of single-pass dynamic mode with its limiter. A failed
 * or unparseable measure falls back to today's single-pass filter; it never fails
 * the render. Pure pieces are tested here without ffmpeg.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  briefToSegments,
  buildFfmpegArgs,
  buildLoudnormMeasureArgs,
  loudnormFilter,
  measureMixLoudness,
  parseLoudnormMeasure,
  type ReelAssemblyBrief,
} from "./services/reelAssembly";

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

describe("parseLoudnormMeasure", () => {
  it("reads the five measured values from a recorded loudnorm JSON block", () => {
    expect(parseLoudnormMeasure(RECORDED)).toEqual({
      input_i: "-19.84",
      input_tp: "-3.12",
      input_lra: "6.40",
      input_thresh: "-30.02",
      target_offset: "0.21",
    });
  });

  it("garbage, a missing field or a non-finite value (a silent track reads -inf) is null", () => {
    expect(parseLoudnormMeasure("ffmpeg exited 1: no such file")).toBeNull();
    expect(parseLoudnormMeasure(RECORDED.replace(/\s*"target_offset" : "0.21"/, ""))).toBeNull();
    expect(parseLoudnormMeasure(RECORDED.replace('"-19.84"', '"-inf"'))).toBeNull();
    expect(parseLoudnormMeasure("{ broken json")).toBeNull();
  });
});

describe("loudnormFilter", () => {
  it("measured -> second pass with measured_* and linear=true at the same target", () => {
    const f = loudnormFilter(parseLoudnormMeasure(RECORDED));
    expect(f).toBe(
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
    const m = parseLoudnormMeasure(RECORDED);
    for (const opts of [base, { ...base, musicPath: null }, { ...base, voPath: null }]) {
      const fc = buildFfmpegArgs({ ...opts, loudnorm: m }).join(" ");
      expect(fc).toContain(`${loudnormFilter(m)},aresample=48000[aout]`);
    }
  });
  it("without a measurement the graph is unchanged (single pass, no measured_)", () => {
    const fc = buildFfmpegArgs(base).join(" ");
    expect(fc).toContain(`${SINGLE},aresample=48000[aout]`);
    expect(fc).not.toContain("measured_");
  });
});

describe("buildLoudnormMeasureArgs: the first pass measures the SAME mix", () => {
  it("audio inputs only, the same duck/mix chain, print_format=json to a null output", () => {
    const args = buildLoudnormMeasureArgs({ ...base, loudnorm: undefined })!;
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(args).toContain("/t/vo.wav");
    expect(args).toContain("/t/music.mp3");
    expect(args).not.toContain("/t/c1.mp4");
    const fc = args[args.indexOf("-filter_complex") + 1];
    // The render's own audio chain, re-indexed to inputs 0 (VO) and 1 (music).
    const render = buildFfmpegArgs(base);
    const renderAudio = render[render.indexOf("-filter_complex") + 1].split(";").filter((l) => /^\[(2:a|3:a|vo_|mus_|am\])/.test(l));
    expect(renderAudio).toHaveLength(6);
    const expected = renderAudio.join(";").replace(/\[2:a\]/g, "[0:a]").replace(/\[3:a\]/g, "[1:a]").replace(`${SINGLE},aresample=48000[aout]`, `${SINGLE}:print_format=json[aout]`);
    expect(fc).toBe(expected);
    expect(args.slice(-3)).toEqual(["-f", "null", "-"]);
  });
  it("no audio at all -> null (nothing to measure)", () => {
    expect(buildLoudnormMeasureArgs({ ...base, voPath: null, musicPath: null })).toBeNull();
  });
});

describe("measureMixLoudness: a failed measure never fails the render", () => {
  it("parses the runner's stderr", async () => {
    expect(await measureMixLoudness(base, async () => RECORDED)).toEqual(parseLoudnormMeasure(RECORDED));
  });
  it("a throwing runner or unparseable stderr -> null (single pass)", async () => {
    expect(await measureMixLoudness(base, async () => { throw new Error("ffmpeg exited 1"); })).toBeNull();
    expect(await measureMixLoudness(base, async () => "no json here")).toBeNull();
  });
  it("no audio -> null without running ffmpeg", async () => {
    let ran = false;
    expect(await measureMixLoudness({ ...base, voPath: null, musicPath: null }, async () => { ran = true; return RECORDED; })).toBeNull();
    expect(ran).toBe(false);
  });
});

describe("assembleReel wiring", () => {
  it("measures the mix and hands the result to the render args", () => {
    const src = readFileSync(path.join(__dirname, "services", "reelAssembly.ts"), "utf8");
    const call = src.indexOf("const args = buildFfmpegArgs({ segs, clipPaths, voPath, assPath, musicPath, fontPath: \"font.ttf\", outPath, askText, loudnorm");
    expect(call).toBeGreaterThan(-1);
    expect(src.lastIndexOf("await measureMixLoudness(", call)).toBeGreaterThan(-1);
  });
});
