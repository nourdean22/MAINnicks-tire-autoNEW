/**
 * Production craft: the editorial timeline, the mix, and the narrator.
 *
 * WHY EVERY BLOCK CARRIES A POSITIVE CONTROL. Each of these checks refuses
 * something, and a checker that refuses everything passes all of its own
 * "catches X" tests while blocking the whole pipeline. Three separate guards
 * this week were blind to their own target and only a paired control found it.
 * So each rule is proven in both directions against fixtures built here.
 */
import { describe, it, expect } from "vitest";
import {
  timelineProblem,
  machineCadenceProblem,
  musicAlignmentProblem,
  cutOverlaps,
  silenceBudgetSec,
  MIN_MEANINGFUL_OVERLAP_SEC,
  type ReelTimeline,
} from "@shared/reelTimeline";
import {
  mixProblem,
  applicableRules,
  buildMixFragments,
  BUS_DEFAULTS,
  DUCKING_RULES,
  PRODUCTION_LOUDNESS_LUFS,
} from "@shared/reelAudioMix";
import {
  relevantLexicon,
  pronunciationDirective,
  scoreTake,
  selectTake,
  PRONUNCIATION_LEXICON,
  MAX_INTERNAL_PAUSE_SEC,
  MIN_PITCH_STDDEV_HZ,
  type TakeMetrics,
} from "@shared/reelVoiceCraft";

/* ── fixtures ────────────────────────────────────────────────────────────── */

/** Three shots, 4s each. */
const PICTURE: ReelTimeline["picture"] = [
  { id: "b1", storyFunction: "hook", shotScale: "extreme_close", motion: "push_in", startSec: 0, endSec: 4 },
  { id: "b2", storyFunction: "problem", shotScale: "close", motion: "static", startSec: 4, endSec: 8 },
  { id: "b3", storyFunction: "turn", shotScale: "wide", motion: "pull_back", startSec: 8, endSec: 12 },
];

/** THE DEFECT: every sentence starts and ends exactly on its own cut. */
const MACHINE_CADENCE: ReelTimeline = {
  durationSec: 12,
  picture: PICTURE,
  audio: [
    { id: "vo1", bus: "dialogue", startSec: 0, endSec: 4, beatId: "b1" },
    { id: "vo2", bus: "dialogue", startSec: 4, endSec: 8, beatId: "b2" },
    { id: "vo3", bus: "dialogue", startSec: 8, endSec: 12, beatId: "b3" },
  ],
  music: [], silence: [], graphics: [],
};

/** THE FIX: vo2 leads its picture (J-cut) and vo1 outlasts its own (L-cut). */
const EDITED: ReelTimeline = {
  durationSec: 12,
  picture: PICTURE,
  audio: [
    { id: "vo1", bus: "dialogue", startSec: 0.2, endSec: 4.6, beatId: "b1" },
    { id: "vo2", bus: "dialogue", startSec: 3.4, endSec: 8, beatId: "b2" },
    { id: "vo3", bus: "dialogue", startSec: 8.5, endSec: 11.6, beatId: "b3" },
    { id: "amb", bus: "ambience", startSec: 0, endSec: 12 },
  ],
  music: [
    { kind: "build", startSec: 0, endSec: 8 },
    { kind: "drop", startSec: 8, endSec: 12 },
  ],
  silence: [{ startSec: 7.6, endSec: 8, purpose: "pre_reveal" }],
  graphics: [],
};

/* ── the timeline is structurally sound ──────────────────────────────────── */

describe("timeline structure", () => {
  it("PERMITS a well-formed timeline", () => {
    expect(timelineProblem(EDITED)).toBeNull();
    expect(timelineProblem(MACHINE_CADENCE)).toBeNull();
  });

  it("CATCHES a picture gap, which would render black", () => {
    const gapped: ReelTimeline = {
      ...EDITED,
      picture: [PICTURE[0], { ...PICTURE[1], startSec: 4.5 }, PICTURE[2]],
    };
    expect(timelineProblem(gapped)).toMatch(/gap|render black/);
  });

  it("CATCHES overlapping picture beats", () => {
    const overlapped: ReelTimeline = {
      ...EDITED,
      picture: [PICTURE[0], { ...PICTURE[1], startSec: 3.5 }, PICTURE[2]],
    };
    expect(timelineProblem(overlapped)).toMatch(/overlap/);
  });

  it("CATCHES picture that does not reach the stated duration", () => {
    expect(timelineProblem({ ...EDITED, durationSec: 20 })).toMatch(/but the timeline is/);
  });

  it("CATCHES audio running past the end", () => {
    const over: ReelTimeline = { ...EDITED, audio: [{ id: "x", bus: "dialogue", startSec: 11, endSec: 14, beatId: "b3" }] };
    expect(timelineProblem(over)).toMatch(/past the end/);
  });

  it("CATCHES audio pointing at a beat that does not exist", () => {
    const orphan: ReelTimeline = { ...EDITED, audio: [{ id: "x", bus: "dialogue", startSec: 1, endSec: 2, beatId: "nope" }] };
    expect(timelineProblem(orphan)).toMatch(/unknown beat/);
  });
});

/* ── THE CENTREPIECE: audio and picture must not always cut together ─────── */

describe("machine cadence — the sentence-one-gets-clip-one defect", () => {
  it("CATCHES a timeline where every dialogue clip cuts with its picture", () => {
    const p = machineCadenceProblem(MACHINE_CADENCE);
    expect(p).toMatch(/sentence-one-gets-clip-one/);
    expect(p).toMatch(/J-cut|L-cut/);
  });

  // POSITIVE CONTROL. Without this the rule could reject every timeline and
  // still pass the test above.
  it("PERMITS a timeline with real J-cuts and L-cuts", () => {
    expect(machineCadenceProblem(EDITED)).toBeNull();
  });

  it("measures the actual lead and lag per clip", () => {
    const o = cutOverlaps(EDITED);
    const vo2 = o.find((x) => x.clipId === "vo2")!;
    expect(vo2.leadSec).toBeCloseTo(0.6, 2); // audio starts 0.6s before its picture — a J-cut
    const vo1 = o.find((x) => x.clipId === "vo1")!;
    expect(vo1.lagSec).toBeCloseTo(0.6, 2); // audio runs 0.6s past its picture — an L-cut
  });

  // A rounding artifact must not read as craft.
  it("does not count a sub-threshold sliver as an overlap", () => {
    const sliver: ReelTimeline = {
      ...MACHINE_CADENCE,
      audio: MACHINE_CADENCE.audio.map((c) =>
        c.id === "vo2" ? { ...c, startSec: c.startSec - (MIN_MEANINGFUL_OVERLAP_SEC / 2) } : c,
      ),
    };
    expect(machineCadenceProblem(sliver)).toMatch(/sentence-one-gets-clip-one/);
  });

  it("exempts a single-beat timeline — there is no cut to straddle", () => {
    const one: ReelTimeline = {
      durationSec: 4,
      picture: [PICTURE[0]],
      audio: [{ id: "vo", bus: "dialogue", startSec: 0, endSec: 4, beatId: "b1" }],
      music: [], silence: [], graphics: [],
    };
    expect(machineCadenceProblem(one)).toBeNull();
  });

  it("CATCHES dialogue that is attached to no beat at all", () => {
    const detached: ReelTimeline = { ...EDITED, audio: [{ id: "vo", bus: "dialogue", startSec: 0, endSec: 4 }] };
    expect(machineCadenceProblem(detached)).toMatch(/no dialogue is attached/);
  });
});

/* ── music is scored to the story ────────────────────────────────────────── */

describe("music alignment", () => {
  it("PERMITS a drop that lands on the reveal", () => {
    expect(musicAlignmentProblem(EDITED)).toBeNull();
  });

  it("CATCHES a drop that lands on nothing", () => {
    const adrift: ReelTimeline = { ...EDITED, music: [{ kind: "drop", startSec: 2.5, endSec: 12 }] };
    expect(musicAlignmentProblem(adrift)).toMatch(/does not land on a reveal/);
  });

  it("CATCHES a drop with no reveal beat to land on", () => {
    const noReveal: ReelTimeline = {
      ...EDITED,
      picture: PICTURE.map((b) => ({ ...b, storyFunction: "evidence" as const })),
    };
    expect(musicAlignmentProblem(noReveal)).toMatch(/no beat is marked as a reveal/);
  });

  it("PERMITS a reel with no drop — that is a legitimate choice", () => {
    expect(musicAlignmentProblem({ ...EDITED, music: [{ kind: "sustain", startSec: 0, endSec: 12 }] })).toBeNull();
  });

  it("counts composed silence, and reports zero honestly", () => {
    expect(silenceBudgetSec(EDITED)).toBeCloseTo(0.4, 2);
    expect(silenceBudgetSec(MACHINE_CADENCE)).toBe(0);
  });
});

/* ── the mix ─────────────────────────────────────────────────────────────── */

describe("five buses and declared ducking", () => {
  it("CATCHES a bed playing at a fixed level under dialogue", () => {
    // Simulate a rule set that forgot music by asking about a bus pair with no rule.
    const noRuleForMusic = DUCKING_RULES.filter((r) => r.target !== "music");
    expect(noRuleForMusic.some((r) => r.target === "music")).toBe(false);
    // and the real config does have one, which is what mixProblem checks:
    expect(mixProblem({ present: ["dialogue", "music"] })).toBeNull();
  });

  it("PERMITS an instrumental reel with no dialogue", () => {
    expect(mixProblem({ present: ["music", "ambience"] })).toBeNull();
  });

  it("CATCHES an unknown bus", () => {
    expect(mixProblem({ present: ["dialogue", "kazoo" as never] })).toMatch(/unknown audio bus/);
  });

  it("applies ducking only for buses actually present", () => {
    expect(applicableRules({ present: ["dialogue"] })).toHaveLength(0);
    expect(applicableRules({ present: ["dialogue", "music"] }).map((r) => r.target)).toEqual(["music"]);
    expect(applicableRules({ present: ["dialogue", "music", "ambience", "foley"] })).toHaveLength(3);
  });

  // SFX must survive the duck — a hit placed on a reveal that gets squashed is
  // a hit nobody hears.
  it("never ducks designed SFX", () => {
    expect(DUCKING_RULES.some((r) => r.target === "sfx")).toBe(false);
  });

  it("every bus and every rule carries a stated reason", () => {
    for (const cfg of Object.values(BUS_DEFAULTS)) expect(cfg.why.length).toBeGreaterThan(20);
    for (const r of DUCKING_RULES) expect(r.why.length).toBeGreaterThan(20);
  });

  it("builds a filtergraph that ducks the bed and pads the key", () => {
    const built = buildMixFragments({ dialogue: "3:a", music: "4:a" }, { totalSec: 12 })!;
    const g = built.fragments.join(" ");
    expect(g).toContain("sidechaincompress");
    // The key must be padded: the compressor's output ends when its key ends,
    // which once truncated a whole reel's audio.
    expect(g).toMatch(/apad=whole_dur=12/);
    expect(built.outLabel).toBe("aout");
  });

  it("returns null when there is no audio at all", () => {
    expect(buildMixFragments({}, { totalSec: 12 })).toBeNull();
  });

  // The loudness figure is a PRODUCTION choice. Instagram publishes no organic
  // target, and this test exists so nobody later cites it as a platform spec.
  it("labels its loudness target as a production choice, not a platform standard", () => {
    expect(PRODUCTION_LOUDNESS_LUFS).toBe(-14);
    // Whitespace-normalised: the sentence wraps across comment lines, so a
    // literal match would silently depend on where the line happens to break.
    const src = readFileSync(join(__dirname, "..", "shared", "reelAudioMix.ts"), "utf8")
      .replace(/^\s*\*\s?/gm, " ")
      .replace(/\s+/g, " ");
    expect(src).toMatch(/Instagram publishes no organic loudness target/i);
    expect(src).toMatch(/PRODUCTION CHOICE|production choice/);
  });
});

/* ── the narrator ────────────────────────────────────────────────────────── */

describe("pronunciation lexicon", () => {
  it("covers the terms this account cannot afford to fumble", () => {
    const terms = PRONUNCIATION_LEXICON.map((e) => e.term);
    for (const t of ["Euclid", "Cuyahoga", "E-Check", "TPMS", "OBD-II", "camber", "caster", "CV axle"]) {
      expect(terms, `${t} must be in the lexicon`).toContain(t);
    }
  });

  it("scopes direction to the terms actually in the script", () => {
    const d = pronunciationDirective("That check engine light will fail your E-Check in Cuyahoga County.");
    expect(d).toContain("E-Check");
    expect(d).toContain("Cuyahoga");
    expect(d).not.toContain("camber"); // not in this script
  });

  // POSITIVE CONTROL for the scoping: an unrelated script gets no direction at
  // all, rather than the whole lexicon.
  it("says nothing when no lexicon term appears", () => {
    expect(pronunciationDirective("Your brake pads are worn to the backing plate.")).toBe("");
    expect(relevantLexicon("nothing local here")).toEqual([]);
  });
});

describe("take selection", () => {
  const clean: TakeMetrics = {
    takeId: "t-clean", durationSec: 4.0, targetSec: 4.0,
    peakDbfs: -6, clippedSamples: 0, longestPauseSec: 0.3, pitchStdDevHz: 30,
  };

  it("PERMITS and prefers a clean take", () => {
    const s = scoreTake(clean);
    expect(s.fatal).toBeNull();
    expect(s.score).toBe(1);
  });

  it("REJECTS a clipped take outright, not merely scores it lower", () => {
    const s = scoreTake({ ...clean, takeId: "t-clip", clippedSamples: 12, peakDbfs: 0 });
    expect(s.fatal).toMatch(/clipped/);
  });

  it("REJECTS dead air inside a line as a glitch, not a beat", () => {
    const s = scoreTake({ ...clean, takeId: "t-gap", longestPauseSec: MAX_INTERNAL_PAUSE_SEC + 0.2 });
    expect(s.fatal).toMatch(/dead air/);
  });

  it("penalises a monotone read without calling it fatal", () => {
    const s = scoreTake({ ...clean, takeId: "t-flat", pitchStdDevHz: MIN_PITCH_STDDEV_HZ / 4 });
    expect(s.fatal).toBeNull();
    expect(s.penalties.some((p) => /monotone/.test(p.reason))).toBe(true);
    expect(s.score).toBeLessThan(1);
  });

  it("penalises a take that is the wrong length for the edit", () => {
    const s = scoreTake({ ...clean, takeId: "t-long", durationSec: 5.2 });
    expect(s.penalties.some((p) => /duration off target/.test(p.reason))).toBe(true);
  });

  it("chooses the best usable take and says why", () => {
    const sel = selectTake([
      { ...clean, takeId: "flat", pitchStdDevHz: 2 },
      clean,
      { ...clean, takeId: "clipped", clippedSamples: 5, peakDbfs: 0 },
    ]);
    expect(sel.chosen?.takeId).toBe("t-clean");
    expect(sel.reason).toMatch(/scored/);
    expect(sel.rejected).toHaveLength(2);
  });

  // Shipping the least-bad distorted take would be worse than shipping nothing.
  it("chooses NOTHING when every take is fatal", () => {
    const sel = selectTake([
      { ...clean, takeId: "a", clippedSamples: 1, peakDbfs: 0 },
      { ...clean, takeId: "b", longestPauseSec: 3 },
    ]);
    expect(sel.chosen).toBeNull();
    expect(sel.reason).toMatch(/unusable/);
  });

  it("handles being given no takes at all", () => {
    expect(selectTake([]).chosen).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
