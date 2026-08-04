/**
 * templateStockStudio — the cheap local reel clip lane.
 *
 * buildBeatClipArgs is pure so the FILTERGRAPH is testable without spawning
 * ffmpeg. That matters more than usual here: rendering real clips found three
 * defects this suite passed straight through, and two of them are pinned below.
 *
 * The clip carries NO TEXT by design — reelAssembly burns each beat's
 * onScreenText over the stitched clips, so drawing text here produced a
 * duplicate caption layer, and the value this lane receives per beat is a
 * provider scene-generation PROMPT rather than viewer-facing copy.
 */
import { describe, expect, it } from "vitest";
import { buildBeatClipArgs } from "./services/templateStockStudio";

const BASE = { seconds: 4, beatNumber: 1, outFile: "beat-1.mp4" };

function vf(args: string[]): string {
  const i = args.indexOf("-vf");
  expect(i).toBeGreaterThan(-1);
  return args[i + 1];
}

describe("buildBeatClipArgs · filtergraph", () => {
  it("draws NO text — assembly owns captions, and the per-beat value is a generation prompt", () => {
    for (const o of [BASE, { ...BASE, backgroundFile: "bg.jpg" }]) {
      const args = buildBeatClipArgs(o);
      expect(vf(args)).not.toContain("drawtext");
      expect(args.join(" ")).not.toContain("textfile");
    }
  });

  it("contains NO SPACES — ffmpeg is spawned with shell:true on win32, which re-splits them", () => {
    // FOUND BY AN ACTUAL RENDER, not by this suite: a space inside the -vf value
    // was re-split by the shell, ffmpeg read the fragment `-` as the output
    // filename and died with "Unable to choose an output format for 'pipe:'".
    // The args array looked perfectly correct either way.
    expect(vf(buildBeatClipArgs(BASE))).not.toMatch(/\s/);
    expect(vf(buildBeatClipArgs({ ...BASE, backgroundFile: "bg.jpg" }))).not.toMatch(/\s/);
  });

  it("references only BARE filenames — an absolute Windows path puts a drive-letter colon inside a colon-delimited option", () => {
    const args = buildBeatClipArgs({ ...BASE, backgroundFile: "bg.jpg" });
    expect(args.join(" ")).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it("carries MOTION with no still supplied — a static video is restricted by Instagram's monetization policy", () => {
    const joined = buildBeatClipArgs(BASE).join(" ");
    expect(joined).toContain("gradients=");
    expect(joined).toContain("speed=");
  });

  it("varies the gradient per beat so a multi-beat reel is not N identical backdrops", () => {
    const tones = [1, 2, 3, 4].map((beatNumber) => {
      const g = buildBeatClipArgs({ ...BASE, beatNumber }).join(" ");
      return g.match(/c1=(0x[0-9A-Fa-f]+)/)?.[1];
    });
    expect(new Set(tones).size).toBeGreaterThan(1);
    // Deterministic: the same beat always renders the same tone.
    expect(buildBeatClipArgs({ ...BASE, beatNumber: 1 })).toEqual(buildBeatClipArgs({ ...BASE, beatNumber: 1 }));
  });

  it("push-ins on a supplied still, restating frame size so zoompan does not fall back to 1x1", () => {
    const args = buildBeatClipArgs({ ...BASE, backgroundFile: "bg.jpg" });
    const graph = vf(args);
    expect(args).toContain("bg.jpg");
    expect(graph).toContain("crop=1080:1920");
    expect(graph).toMatch(/zoompan=.*s=1080x1920/);
    // d= is in OUTPUT frames — 4s at 30fps.
    expect(graph).toContain("d=120");
  });

  it("renders vertical, yuv420p and SILENT — assembly lays the voiceover over the stitched clips", () => {
    const args = buildBeatClipArgs(BASE);
    expect(args).toContain("-an");
    expect(args).toContain("yuv420p");
    expect(args).toContain("+faststart");
  });

  it("bounds the clip to the requested duration", () => {
    const args = buildBeatClipArgs({ ...BASE, seconds: 3 });
    expect(args[args.indexOf("-t") + 1]).toBe("3");
  });
});
