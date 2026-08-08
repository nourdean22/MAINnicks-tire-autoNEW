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
import { buildBeatClipArgs, motionForBeat, type BeatMotion } from "./services/templateStockStudio";

const BASE = { seconds: 4, beatNumber: 1, outFile: "beat-1.mp4" };

/**
 * Listed explicitly rather than exported from the module: if someone adds a move
 * and does not add it here, the per-motion invariant tests below silently stop
 * covering it. A hardcoded list fails to compile instead.
 */
const ALL_MOTIONS: BeatMotion[] = ["push_in", "punch_in", "pull_out", "pan_right", "pan_left", "drift_up"];

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

/**
 * CAMERA MOVES (2026-08-07).
 *
 * There used to be exactly one move — a slow push-in — so a 5-6 beat still-backed
 * reel was N identical Ken Burns pushes. Individually fine, collectively filler,
 * and `HARD_REJECT_RULES[0]` ("generic mechanic imagery any shop could run
 * unchanged") is the bar this lane has to clear. Repetition is what makes an
 * asset read generic.
 *
 * The two properties that were hard-won for the ORIGINAL filtergraph have to hold
 * for EVERY new move, not just the default, so they are re-asserted per-motion
 * below rather than trusted from the single-case tests above.
 */
describe("buildBeatClipArgs · camera moves", () => {
  const STILL = { ...BASE, backgroundFile: "bg.jpg" as const };

  it("offers more than one move, and the rotation actually differs across a reel's beats", () => {
    const moves = [1, 2, 3, 4, 5, 6].map((beatNumber) => motionForBeat(beatNumber));
    expect(new Set(moves).size).toBeGreaterThan(3);
  });

  it("is DETERMINISTIC per beat — a retry must not splice a different camera into the reel", () => {
    expect(motionForBeat(3)).toBe(motionForBeat(3));
    expect(buildBeatClipArgs({ ...STILL, beatNumber: 3 })).toEqual(
      buildBeatClipArgs({ ...STILL, beatNumber: 3 }),
    );
  });

  it("produces a DIFFERENT filtergraph for consecutive beats on the same still", () => {
    const a = vf(buildBeatClipArgs({ ...STILL, beatNumber: 1 }));
    const b = vf(buildBeatClipArgs({ ...STILL, beatNumber: 2 }));
    expect(a).not.toBe(b);
  });

  it.each(ALL_MOTIONS)("%s: contains NO SPACES — shell:true on win32 re-splits them", (motion) => {
    // The defect this pins was found by an actual render, not by a unit test:
    // one space inside -vf made ffmpeg read a fragment as the output filename.
    expect(vf(buildBeatClipArgs({ ...STILL, motion }))).not.toMatch(/\s/);
  });

  it.each(ALL_MOTIONS)("%s: still restates the frame size, or zoompan silently falls back to 1x1", (motion) => {
    const graph = vf(buildBeatClipArgs({ ...STILL, motion }));
    expect(graph).toMatch(/zoompan=.*s=1080x1920/);
    expect(graph).toContain("d=120");
    expect(graph).toContain("fps=30");
  });

  it.each(ALL_MOTIONS)("%s: draws no text and references only bare filenames", (motion) => {
    const args = buildBeatClipArgs({ ...STILL, motion });
    expect(vf(args)).not.toContain("drawtext");
    expect(args.join(" ")).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it("a PAN keeps zoom above 1 — at z=1 the crop window fills the frame and the pan renders STATIC", () => {
    // The specific trap: (iw-iw/zoom) is 0 at zoom=1, so x/y never move and the
    // clip is a still. Instagram's monetization policy restricts static video, so
    // a silently-static clip is worse than a failed render.
    for (const motion of ["pan_left", "pan_right", "drift_up"] as const) {
      const graph = vf(buildBeatClipArgs({ ...STILL, motion }));
      const z = graph.match(/zoompan=z=([0-9.]+)/)?.[1];
      expect(z, `${motion} must pin a constant zoom`).toBeDefined();
      expect(Number(z)).toBeGreaterThan(1);
    }
  });

  it("pull_out never zooms BELOW 1 — that would letterbox the frame", () => {
    const graph = vf(buildBeatClipArgs({ ...STILL, motion: "pull_out" }));
    expect(graph).toContain("max(");
    const floor = graph.match(/max\([^,]+,([0-9.]+)\)/)?.[1];
    expect(Number(floor)).toBeGreaterThanOrEqual(1);
  });

  it("push_in is unchanged — the one variant proven by real renders", () => {
    expect(vf(buildBeatClipArgs({ ...STILL, motion: "push_in" }))).toContain(
      "zoompan=z='min(zoom+0.0009,1.12)'",
    );
  });

  it("the gradient path varies ANGLE as well as tone — every beat swept the same diagonal before", () => {
    const angles = [1, 2, 3, 4].map((beatNumber) => {
      const g = buildBeatClipArgs({ ...BASE, beatNumber }).join(" ");
      return g.match(/x0=\d+:y0=\d+:x1=\d+:y1=\d+/)?.[0];
    });
    expect(new Set(angles).size).toBeGreaterThan(1);
  });

  it("motion is ignored on the gradient path — there is no still to move a camera over", () => {
    const a = buildBeatClipArgs({ ...BASE, motion: "pan_left" });
    const b = buildBeatClipArgs({ ...BASE, motion: "punch_in" });
    expect(a).toEqual(b);
  });
});

/**
 * REAL FOOTAGE (2026-08-07).
 *
 * Footage is the one asset class that clears HARD_REJECT_RULES[0] ("generic
 * mechanic imagery any shop could run unchanged") by construction — no other
 * shop can run video of Nick's bay. So it outranks a camera move over a still.
 *
 * It needs two things a still does not, and does NOT want a third:
 *   · looping — the source may be shorter than the beat, and without
 *     `-stream_loop -1` the clip ends early or freezes on its last frame
 *   · fps normalisation — sources arrive at 24/25/30/60 and the output -r alone
 *     drops/duplicates frames unevenly, which judders
 *   · NOT a zoompan — the footage already moves; stacking a synthetic push over
 *     real movement reads as amateur
 */
describe("buildBeatClipArgs · real footage", () => {
  const VID = { ...BASE, backgroundVideoFile: "bg.mp4" as const };

  it("loops the source so a short clip fills a long beat, and truncates back to the beat length", () => {
    const args = buildBeatClipArgs(VID);
    const loopAt = args.indexOf("-stream_loop");
    const inputAt = args.indexOf("-i");
    expect(loopAt).toBeGreaterThan(-1);
    expect(args[loopAt + 1]).toBe("-1");
    // -stream_loop is an INPUT option: after its own -i it is silently ignored.
    expect(loopAt).toBeLessThan(inputAt);
    expect(args[args.indexOf("-t") + 1]).toBe("4");
  });

  it("normalises fps — sources arrive at 24/25/30/60 and uneven frame drops judder", () => {
    expect(vf(buildBeatClipArgs(VID))).toContain("fps=30");
  });

  it("applies NO zoompan — the footage already carries its own motion", () => {
    expect(vf(buildBeatClipArgs(VID))).not.toContain("zoompan");
  });

  it("still fills the vertical frame", () => {
    const graph = vf(buildBeatClipArgs(VID));
    expect(graph).toContain("force_original_aspect_ratio=increase");
    expect(graph).toContain("crop=1080:1920");
  });

  it("FOOTAGE WINS over a still when both are supplied", () => {
    const args = buildBeatClipArgs({ ...VID, backgroundFile: "bg.jpg" });
    expect(args).toContain("bg.mp4");
    expect(args).not.toContain("bg.jpg");
    expect(vf(args)).not.toContain("zoompan");
  });

  it("an explicit motion is ignored on footage — it must not reintroduce a synthetic push", () => {
    for (const motion of ALL_MOTIONS) {
      expect(vf(buildBeatClipArgs({ ...VID, motion }))).not.toContain("zoompan");
    }
  });

  it("keeps the two invariants that were hard-won for the other paths", () => {
    const args = buildBeatClipArgs(VID);
    expect(vf(args)).not.toMatch(/\s/); // shell:true re-splits spaces
    expect(args.join(" ")).not.toMatch(/[A-Za-z]:[\\/]/); // bare filenames only
    expect(vf(args)).not.toContain("drawtext"); // assembly owns captions
    expect(args).toContain("-an"); // silent; assembly lays the VO
  });
});
