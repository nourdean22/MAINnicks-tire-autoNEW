/**
 * Finish pass for Higgsfield-UI masters (2026-10-10): the pure argv builder.
 * The three pilot Reels were published with no music, no loudness
 * normalisation and no grain because they never went through reelAssembly;
 * these pins hold the graph that gives an external master the same finish.
 */
import { describe, expect, it } from "vitest";
import { FINISH_MUSIC_VOLUME, buildFinishArgs } from "./services/externalMasterFinish";

const base = { inputPath: "in.mp4", outPath: "out.mp4", durationSec: 15, optical: "null" };
const graph = (args: string[]) => args[args.indexOf("-filter_complex") + 1];

describe("buildFinishArgs — audio", () => {
  it("master audio + music bed: the bed loops under the native track, the native track defines the length", () => {
    const args = buildFinishArgs({ ...base, musicPath: "bed.mp3", hasAudio: true });
    const loop = args.indexOf("-stream_loop");
    expect(loop).toBeGreaterThan(-1);
    expect(args.slice(loop, loop + 4)).toEqual(["-stream_loop", "-1", "-i", "bed.mp3"]);
    const g = graph(args);
    expect(g).toContain(`volume=${FINISH_MUSIC_VOLUME}`);
    expect(g).toContain("amix=inputs=2:duration=first:normalize=0");
    expect(g).toContain("loudnorm=I=-14:TP=-1.5:LRA=11");
    expect(args).toContain("[aout]");
    expect(args).not.toContain("-an");
  });

  it("no native audio: the bed alone becomes the track, still normalised to the delivery target", () => {
    const g = graph(buildFinishArgs({ ...base, musicPath: "bed.mp3", hasAudio: false }));
    expect(g).toContain("[1:a]");
    expect(g).not.toContain("amix");
    expect(g).not.toContain("[0:a]");
    expect(g).toContain("loudnorm=I=-14");
  });

  it("no bed available: the native track is only normalised, never dropped", () => {
    const args = buildFinishArgs({ ...base, musicPath: null, hasAudio: true });
    expect(graph(args)).toContain("[0:a]aresample=48000,atrim=0:15");
    expect(args).not.toContain("-stream_loop");
    expect(args).not.toContain("-an");
  });

  it("silent master and no bed: the output is explicitly video-only (nothing invents an audio stream)", () => {
    const args = buildFinishArgs({ ...base, musicPath: null, hasAudio: false });
    expect(args).toContain("-an");
    expect(graph(args)).not.toContain("[aout]");
  });
});

describe("buildFinishArgs — picture and container", () => {
  it("never rescales: the master's geometry is kept and only the optical finish is applied", () => {
    const g = graph(buildFinishArgs({ ...base, musicPath: null, hasAudio: true, optical: "noise=c0s=8:allf=t+u,vignette=PI/12" }));
    expect(g).toContain("[0:v]fps=30,setsar=1,format=yuv420p,noise=c0s=8:allf=t+u,vignette=PI/12[vout]");
    expect(g).not.toContain("scale=");
    expect(g).not.toContain("crop=");
  });

  it("cuts to the master's exact duration and tags Rec.709 like reelAssembly", () => {
    const args = buildFinishArgs({ ...base, musicPath: "bed.mp3", hasAudio: true, durationSec: 15.0004 });
    expect(args[args.indexOf("-t") + 1]).toBe("15");
    for (const flag of ["-color_primaries", "-color_trc", "-colorspace"]) expect(args[args.indexOf(flag) + 1]).toBe("bt709");
    expect(args[args.indexOf("-crf") + 1]).toBe("20");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
    expect(args[args.length - 1]).toBe("out.mp4");
  });
});
