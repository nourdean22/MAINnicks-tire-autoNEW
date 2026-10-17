/**
 * Reel quality fixes (job 2026-10-16-reel-quality-fixes), measured on reel 2100001:
 *  - every cut hitched: each non-last beat froze for the whole 0.5 s xfade
 *    (clone pad) even when its 5.04 s source had real footage to spare, and the
 *    Wan clips hold their first frame for about half a second;
 *  - two-line captions drew two overlapping boxes (one per line).
 * The xfade offsets and the total duration must not move: the render-integrity
 * gate judges the output against sum(durs) + the 3 s SAVE freeze.
 */
import { describe, expect, it } from "vitest";
import { buildFfmpegArgs, CAPTION_BEAT_Y_FRAC, type ReelSegment } from "./services/reelAssembly";

/** A generated (provider) clip by default: the measured start hold is a property of those clips. */
const seg = (beatNumber: number, sourceDurationSec?: number, caption = "CHECK IT", sourceIsGenerated = true): ReelSegment => ({
  beatNumber,
  dur: 4,
  caption,
  fontSize: 56,
  ...(sourceDurationSec === undefined ? {} : { sourceDurationSec, sourceIsGenerated }),
});

describe("the start-hold skip is for generated clips only (Codex P2 on #3087)", () => {
  // realShotBinding records a registry_real_shop shot as trimInSec 0; cutting its
  // first 0.5 s would show different frames than the lineage says. It still runs
  // real footage through the fade (that removes nothing).
  it("a long real-shop source keeps start 0 and runs real footage through the xfade", () => {
    const c = chain(filterGraph([seg(1, 5.04, "REAL", false), seg(2, 5.04)]), 0);
    expect(c).toContain("trim=0:4.5,");
    expect(c).not.toContain("tpad");
  });
  it("a long generated source still skips its 0.5 s hold", () => {
    expect(chain(filterGraph([seg(1, 5.04), seg(2, 5.04)]), 0)).toContain("trim=0.5:5,");
  });
});

function filterGraph(segs: ReelSegment[]): string {
  const args = buildFfmpegArgs({
    segs,
    clipPaths: segs.map((_, i) => `c${i}.mp4`),
    voPath: null,
    musicPath: null,
    assPath: null,
    fontPath: "font.ttf",
    outPath: "out.mp4",
    askText: null,
  });
  return args[args.indexOf("-filter_complex") + 1];
}

/** The per-beat normalisation chain for input i. */
function chain(fc: string, i: number): string {
  const m = fc.match(new RegExp(`\\[${i}:v\\][^;]*\\[v${i}\\]`));
  if (!m) throw new Error(`no chain for input ${i}`);
  return m[0];
}

describe("cut pad: real footage through the xfade instead of a frozen clone", () => {
  // 5.04 s Wan source, 4.0 s Seedance-length source, 4.49 s (one hundredth short of the xfade), last 5.04 s
  const segs = [seg(1, 5.04), seg(2, 4.0), seg(3, 4.49), seg(4, 5.04)];
  const fc = filterGraph(segs);

  it("(a)+(b) a long source skips its 0.5 s start hold and runs real footage through the xfade: trim=0.5:5, no tpad", () => {
    expect(chain(fc, 0)).toContain("trim=0.5:5,");
    expect(chain(fc, 0)).not.toContain("tpad");
  });

  it("(c) a 4.0 s source under a 4 s beat keeps today's clone pad and trim=0:4", () => {
    expect(chain(fc, 1)).toContain("trim=0:4,");
    expect(chain(fc, 1)).toContain("tpad=stop_mode=clone:stop_duration=0.5[v1]");
  });

  it("a 4.49 s source cannot cover the 0.5 s xfade: offset 0, clone pad as today", () => {
    expect(chain(fc, 2)).toContain("trim=0:4,");
    expect(chain(fc, 2)).toContain("tpad=stop_mode=clone:stop_duration=0.5[v2]");
  });

  it("the last beat needs no xfade footage: a long source still skips the start hold", () => {
    expect(chain(fc, 3)).toContain("trim=0.5:4.5,");
    expect(chain(fc, 3)).toContain("tpad=stop_mode=clone[v3]");
  });

  it("(d) xfade offsets and the -t total are exactly sum(durs) based, as before", () => {
    expect(fc).toContain("offset=4.00[xf1]");
    expect(fc).toContain("offset=8.00[xf2]");
    expect(fc).toContain("offset=12.00[vc]");
    const args = buildFfmpegArgs({ segs, clipPaths: segs.map((_, i) => `c${i}.mp4`), voPath: null, musicPath: null, assPath: null, fontPath: "font.ttf", outPath: "out.mp4" });
    expect(args[args.indexOf("-t") + 1]).toBe("19"); // 16 s of beats + 3 s SAVE
  });

  it("an unprobed source keeps today's chain byte for byte", () => {
    const c = chain(filterGraph([seg(1), seg(2)]), 0);
    expect(c).toContain("trim=0:4,");
    expect(c).toContain("tpad=stop_mode=clone:stop_duration=0.5[v0]");
  });

  // Boundary probes (guard-red-team): the xfade needs dur + 0.5 = 4.5 s, the start offset needs 5.0 s.
  it.each([
    [4.49, "trim=0:4,", true],
    [4.5, "trim=0:4.5,", false],
    [4.51, "trim=0:4.5,", false],
    [4.99, "trim=0:4.5,", false],
    [5.0, "trim=0.5:5,", false],
    [5.01, "trim=0.5:5,", false],
  ])("source %s s -> %s (clone pad: %s)", (src, trim, padded) => {
    const c = chain(filterGraph([seg(1, src), seg(2, 5.04)]), 0);
    expect(c).toContain(trim);
    expect(c.includes("tpad")).toBe(padded);
  });
});

describe("captions: one plate per caption, no overlapping per-line boxes", () => {
  const fc = filterGraph([
    seg(1, 5.04, "HOOK LINE"),
    seg(2, 5.04, "CHECK THE INNER EDGE\nBEFORE IT CORDS"),
    seg(3, 5.04, "ONE LINE"),
  ]);
  const beatDrawtexts = fc.split(";").filter((f) => f.includes("textfile='caption_") && !f.includes("caption_save"));

  it("no caption drawtext draws its own box (the per-line boxes overlapped by ~35 px)", () => {
    expect(beatDrawtexts.length).toBe(4); // 1 + 2 + 1 lines
    for (const d of beatDrawtexts) expect(d).not.toContain("box=1");
  });

  it("each caption gets exactly one background plate on its own time window", () => {
    const plates = fc.split(";").filter((f) => f.includes("drawbox="));
    expect(plates.length).toBe(3);
    expect(plates[1]).toContain("enable='gte(t,4.00)*lt(t,8.00)'");
  });

  it("a beat plate spans both lines: top at the anchor minus the 28 px border, height (lines-1)*lineH + size + 56", () => {
    const plate = fc.split(";").find((f) => f.includes("drawbox=") && f.includes("gte(t,4.00)"))!;
    expect(plate).toContain(`y=ih*${CAPTION_BEAT_Y_FRAC}-28`);
    expect(plate).toContain(`h=${Math.round(56 * 1.2) + 56 + 56}`);
    expect(plate).toContain("color=black@0.6");
  });

  it("the hook plate is centred with the hook's line block", () => {
    const plate = fc.split(";").find((f) => f.includes("drawbox=") && f.includes("gte(t,0.00)"))!;
    expect(plate).toMatch(/y=\(ih-\d+\)\/2-28/);
  });

  it("an empty caption draws no plate", () => {
    const g = filterGraph([seg(1, 5.04, "HOOK"), seg(2, 5.04, "")]);
    expect(g.split(";").filter((f) => f.includes("drawbox=")).length).toBe(1);
  });
});
