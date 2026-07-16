import { describe, it, expect } from "vitest";
import {
  sanitizeCaption,
  captionFontSize,
  wrapCaption,
  briefToSegments,
  segmentsTotalSeconds,
  buildFfmpegArgs,
  type ReelAssemblyBrief,
} from "./services/reelAssembly";

const BRIEF: ReelAssemblyBrief = {
  id: "b1",
  voiceoverScript: "Something is stealing your air.",
  selectedCaption: "Cold mornings, the light pops on.",
  storyboardBeats: [
    { beatNumber: 1, startSecond: 0, endSecond: 2, onScreenText: "The PSI heist", visual: "x" },
    { beatNumber: 2, startSecond: 2, endSecond: 6, onScreenText: "10F colder = 1 psi lost", visual: "x" },
    { beatNumber: 3, startSecond: 6, endSecond: 9, onScreenText: "Air it back up", visual: "x" },
  ],
};

describe("sanitizeCaption", () => {
  it("collapses whitespace and uppercases", () => {
    expect(sanitizeCaption("It's a\n  test")).toBe("IT'S A TEST");
  });
  it("returns empty string for empty/whitespace input", () => {
    expect(sanitizeCaption("   ")).toBe("");
  });
  it("PRESERVES apostrophes (textfile mode is safe — deleting them changed meaning, e.g. TIRE'S→TIRES)", () => {
    expect(sanitizeCaption("don't guess")).toBe("DON'T GUESS");
    // The exact caption observed live 2026-07-16 that motivated this fix:
    expect(sanitizeCaption("Your tires' secret job")).toBe("YOUR TIRES' SECRET JOB");
  });
  it("still strips backslash and percent — drawtext breakers even in textfile mode", () => {
    const out = sanitizeCaption("20% off \\ deal");
    expect(out).toBe("20 OFF DEAL");
    expect(out).not.toMatch(/[\\%]/);
  });
  it("neutralizes a %{...} expansion sequence so drawtext cannot interpret it", () => {
    expect(sanitizeCaption("save %{pts} now")).not.toContain("%{");
  });
});

describe("wrapCaption", () => {
  it("leaves a short caption on one line", () => {
    expect(wrapCaption("AIR IT UP")).toBe("AIR IT UP");
  });
  it("wraps a long caption to two balanced lines at a word boundary", () => {
    const out = wrapCaption("SIDEWALL MAX DOOR STICKER YOUR PSI");
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    // Every line fits the mobile budget.
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(20);
  });
  it("wraps the exact overflowing caption observed live into two readable lines", () => {
    const out = wrapCaption(sanitizeCaption("Your tires' secret job: CLEAR water fast"));
    expect(out.split("\n").length).toBeLessThanOrEqual(2);
    expect(out).toContain("\n"); // it WAS one overflowing line before
    expect(out).toContain("'");  // apostrophe survives the wrap
  });
  it("never produces more than two lines", () => {
    const out = wrapCaption("ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN");
    expect(out.split("\n").length).toBeLessThanOrEqual(2);
  });
});

describe("captionFontSize", () => {
  it("shrinks as the caption gets longer", () => {
    const short = captionFontSize("AIR IT UP");
    const long = captionFontSize("TEN DEGREES COLDER MEANS ONE PSI LOST EVERY TIME");
    expect(short).toBeGreaterThan(long);
  });
  it("stays within the proven 44-64 range", () => {
    for (const s of ["A", "AIR IT BACK UP NOW BEFORE THE NEXT COLD SNAP HITS HARD"]) {
      const size = captionFontSize(s);
      expect(size).toBeGreaterThanOrEqual(44);
      expect(size).toBeLessThanOrEqual(64);
    }
  });
});

describe("briefToSegments", () => {
  it("derives one segment per beat with duration = endSecond - startSecond", () => {
    const segs = briefToSegments(BRIEF);
    expect(segs.map((s) => s.dur)).toEqual([2, 4, 3]);
    // "10F COLDER = 1 PSI LOST" is 23 chars — over the 20-char mobile budget —
    // so briefToSegments wraps it to two balanced lines.
    expect(segs.map((s) => s.caption)).toEqual(["THE PSI HEIST", "10F COLDER\n= 1 PSI LOST", "AIR IT BACK UP"]);
  });
  it("sorts by beatNumber so out-of-order beats still assemble correctly", () => {
    const shuffled: ReelAssemblyBrief = { ...BRIEF, storyboardBeats: [...BRIEF.storyboardBeats].reverse() };
    expect(briefToSegments(shuffled).map((s) => s.beatNumber)).toEqual([1, 2, 3]);
  });
  it("caps a too-long beat at the seedance clip length (4s) and floors invalid durations", () => {
    const weird: ReelAssemblyBrief = {
      storyboardBeats: [
        { beatNumber: 1, startSecond: 0, endSecond: 99, onScreenText: "too long", visual: "x" },
        { beatNumber: 2, startSecond: 0, endSecond: 0, onScreenText: "zero", visual: "x" },
      ],
    };
    const segs = briefToSegments(weird);
    expect(segs[0].dur).toBe(4); // capped to clip length
    expect(segs[1].dur).toBeGreaterThan(0); // invalid -> sensible default, never 0/negative
  });
  it("throws when there are no beats (nothing to assemble)", () => {
    expect(() => briefToSegments({ storyboardBeats: [] })).toThrow();
  });
});

describe("segmentsTotalSeconds", () => {
  it("sums segment durations", () => {
    expect(segmentsTotalSeconds(briefToSegments(BRIEF))).toBe(9);
  });
});

describe("buildFfmpegArgs", () => {
  const segs = briefToSegments(BRIEF);
  const base = {
    segs,
    clipPaths: ["/t/c1.mp4", "/t/c2.mp4", "/t/c3.mp4"],
    voPath: "/t/vo.wav",
    musicPath: "/t/music.mp3",
    fontPath: "/usr/share/fonts/DejaVuSans-Bold.ttf",
    outPath: "/t/out.mp4",
  };

  it("lists clip inputs in order, then VO, then music", () => {
    const args = buildFfmpegArgs(base);
    const inputs = args.filter((_, i) => args[i - 1] === "-i");
    expect(inputs).toEqual(["/t/c1.mp4", "/t/c2.mp4", "/t/c3.mp4", "/t/vo.wav", "/t/music.mp3"]);
  });

  it("scales every beat to a 1080x1920 vertical frame and xfades them", () => {
    const fc = buildFfmpegArgs(base).join(" ");
    expect(fc).toContain("scale=1080:1920:force_original_aspect_ratio=increase");
    expect(fc).toContain("crop=1080:1920");
    expect(fc).toContain("xfade=transition=fade");
  });

  it("burns captions on HALF-OPEN intervals (no double-rendered frame at cuts)", () => {
    const fc = buildFfmpegArgs(base).join(" ");
    // beat 1: 0.00..2.00, beat 2: 2.00..6.00, beat 3: 6.00..9.00
    expect(fc).toContain("enable='gte(t,0.00)*lt(t,2.00)'");
    expect(fc).toContain("enable='gte(t,2.00)*lt(t,6.00)'");
    expect(fc).toContain("enable='gte(t,6.00)*lt(t,9.00)'");
    expect(fc).not.toContain("between(t"); // inclusive between() double-renders the cut frame
  });

  it("ducks music UNDER the VO via sidechaincompress (not a static volume) and pads through the freeze", () => {
    const fc = buildFfmpegArgs(base).join(" ");
    expect(fc).toContain("volume=1.15"); // VO loud
    expect(fc).toContain("sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400"); // dynamic duck keyed off VO
    expect(fc).not.toContain("volume=0.16"); // the old static duck is gone
    expect(fc).toContain("amix=inputs=2");
    // 9s of beats + 3s save-payload freeze => audio trimmed/padded to 12s
    expect(fc).toContain("atrim=0:12");
    expect(fc).toContain("apad=whole_dur=12");
  });

  it("adds per-beat push-in motion + a save-payload freeze with a SAVE overlay (Phase 3.1/4.1)", () => {
    const args = buildFfmpegArgs(base);
    const fc = args.join(" ");
    expect(fc).toContain("zoompan=z='min(pzoom+"); // Ken Burns per beat
    expect(fc).toContain("tpad=stop_mode=clone:stop_duration=3"); // freeze final frame 3s
    expect(fc).toContain("textfile='caption_save.txt'"); // save-payload prompt
    expect(fc).toContain("[vout]");
    const tIdx = args.indexOf("-t");
    expect(args[tIdx + 1]).toBe("12"); // 9s of beats + 3s freeze
  });

  it("normalizes loudness to -14 LUFS on the final audio (every audio branch)", () => {
    const target = "loudnorm=I=-14:TP=-1.5:LRA=11";
    expect(buildFfmpegArgs(base).join(" ")).toContain(target); // VO + music
    expect(buildFfmpegArgs({ ...base, musicPath: null }).join(" ")).toContain(target); // VO only
    expect(buildFfmpegArgs({ ...base, voPath: null }).join(" ")).toContain(target); // music only
  });

  it("brands captions in Nick's yellow and opens beat 1 as a centered hook", () => {
    const fc = buildFfmpegArgs(base).join(" ");
    expect(fc).toContain("fontcolor=0xFDB913"); // brand yellow, not white
    expect(fc).not.toContain("fontcolor=white");
    expect(fc).toContain("y=(h-text_h)/2"); // beat 1 hook, screen-centered
    expect(fc).toContain("y=h*0.62"); // later captions in the lower third (out of IG safe zone)
  });

  it("emits an IG-ready H.264 +faststart mp4 mapped from the final video/audio labels", () => {
    const args = buildFfmpegArgs(base);
    expect(args).toContain("libx264");
    expect(args.join(" ")).toContain("-pix_fmt yuv420p");
    expect(args.join(" ")).toContain("-movflags +faststart");
    expect(args.slice(-1)[0]).toBe("/t/out.mp4");
    expect(args).toContain("[vout]");
    expect(args).toContain("[aout]");
  });

  it("degrades gracefully with no music: VO becomes the audio track, no amix", () => {
    const fc = buildFfmpegArgs({ ...base, musicPath: null }).join(" ");
    expect(fc).not.toContain("amix");
    expect(fc).toContain("[aout]");
  });

  it("produces a silent reel when neither VO nor music is available", () => {
    const args = buildFfmpegArgs({ ...base, voPath: null, musicPath: null });
    const fc = args.join(" ");
    expect(fc).not.toContain("amix");
    // video still maps and renders
    expect(args).toContain("[vout]");
  });
});
