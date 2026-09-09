/**
 * ONE AVERAGED NUMBER CANNOT SAY BOTH "NEVER SHIP THIS" AND "THIS COULD BE BETTER".
 *
 * The scale is 75 points and the threshold is 70, so there are exactly 5 points
 * of slack - and FIVE separate 5-point parts. Any one of them could fail while
 * the reel still passed at exactly 70. A part whose weight equals the slack
 * cannot block anything by itself.
 *
 * That is not hypothetical. The distinctiveness part shipped earlier the same
 * day is worth 5 points, which meant a maximally derivative brief - same topic,
 * keyword, archetype, lens and object as a recent reel - scored 70 and passed.
 * The gate written to stop repetition was arithmetically incapable of stopping
 * anything.
 *
 * Two further defects found while checking that one:
 *
 *  · The check ran at ONE of seven call sites. The other six scored live briefs
 *    with it permanently dark and paid its 5 points anyway, silently demanding a
 *    perfect score on every other part.
 *
 *  · getRecentReelSignals returns identical empty arrays whether the window was
 *    genuinely empty or the database was unreachable. Wired in naively, a DB
 *    outage would have scored as perfect originality.
 *
 * So: hard gates are listed and evaluated separately from the total, the
 * distinctiveness part is graduated per signal, and "could not look" is no
 * longer spelled the same way as "nothing to repeat".
 */
import { describe, it, expect } from "vitest";
import { calculateReelQualityScore, repeatedSignalCount } from "../client/src/lib/facelessReelStudio";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";

const sample = () => structuredClone(SAMPLE_REEL_BRIEFS[0]);

/** A window that contains this exact brief on every axis - the same reel again. */
function windowContaining(b: ReturnType<typeof sample>) {
  return {
    topics: [b.topic],
    keywords: [b.campaignKeyword],
    archetypes: [b.archetype],
    motionLenses: [b.motionLens],
    objectCharacters: [b.objectCharacter],
    available: true,
  };
}

/** A window that shares NOTHING with this brief. */
const FRESH_WINDOW = {
  topics: ["something else entirely"],
  keywords: ["UNRELATED"],
  archetypes: ["silent_film_title_cards"],
  motionLenses: ["neon_retro_futurist"],
  objectCharacters: ["a completely different object"],
  available: true,
};

describe("hard gates are separate from the score, and cannot be outscored", () => {
  it("the result exposes them as their own list", () => {
    const r = calculateReelQualityScore(sample());
    expect(Array.isArray(r.hardGates)).toBe(true);
    expect(r.hardGates.length).toBeGreaterThanOrEqual(3);
    for (const g of r.hardGates) {
      expect(typeof g.name).toBe("string");
      expect(typeof g.ok).toBe("boolean");
      expect(g.detail.length).toBeGreaterThan(0);
    }
  });

  it("a blocked claim fails even with the threshold dropped to ZERO", () => {
    // This is the whole point of the split. Before, claim safety only happened
    // to be fatal because losing 10 points landed under a threshold of 70 - an
    // arithmetic accident, not a rule. Retune the weights or the threshold and
    // it silently stops being fatal. Now it is stated.
    const bad = sample();
    bad.voiceoverScript = "We guarantee this fix will last forever.";
    bad.selectedCaption = bad.voiceoverScript;
    const r = calculateReelQualityScore(bad, 0);
    expect(r.overall).toBeGreaterThan(0);
    expect(r.passing, "a guarantee claim passed because the score was high enough").toBe(false);
    expect(r.hardGates.find((g) => g.name === "No blocked claims")?.ok).toBe(false);
    expect(r.gate).toBe("block");
  });

  it("a clean brief trips no gate", () => {
    const r = calculateReelQualityScore(sample(), 0, { recent: FRESH_WINDOW });
    expect(r.hardGates.filter((g) => !g.ok)).toHaveLength(0);
    expect(r.passing).toBe(true);
  });

  it("every curated sample brief still passes - the split did not tighten the bar", () => {
    for (const b of SAMPLE_REEL_BRIEFS) {
      const r = calculateReelQualityScore(b);
      expect(r.passing, `${b.id} scored ${r.overall}/75: ${r.reasoning.join(" | ")}`).toBe(true);
    }
  });
});

describe("distinctiveness is graduated, and its floor is a hard gate", () => {
  it("repeating ONE signal costs one point, not the whole part", () => {
    const b = sample();
    const oneRepeat = { ...FRESH_WINDOW, archetypes: [b.archetype] };
    const r = calculateReelQualityScore(b, 70, { recent: oneRepeat });
    const part = r.parts.find((p) => p.label === "Distinct from recent reels");
    expect(part?.points, "all-or-nothing scoring is back").toBe(4);
    expect(part?.ok).toBe(false);
    // and it is still a passing reel - one repeated archetype is ordinary
    expect(r.passing).toBe(true);
  });

  it("a brand new brief scores the full part", () => {
    const r = calculateReelQualityScore(sample(), 70, { recent: FRESH_WINDOW });
    expect(r.parts.find((p) => p.label === "Distinct from recent reels")?.points).toBe(5);
  });

  it("repeating EVERY signal is the same reel again, and is refused outright", () => {
    const b = sample();
    const r = calculateReelQualityScore(b, 0, { recent: windowContaining(b) });
    expect(repeatedSignalCount(b, windowContaining(b))).toBe(5);
    expect(r.parts.find((p) => p.label === "Distinct from recent reels")?.points).toBe(0);
    const dup = r.hardGates.find((g) => g.name === "Not a duplicate of a recent reel");
    expect(dup?.ok, "a byte-for-byte repeat of a recent reel was allowed through").toBe(false);
    // and it blocks even at threshold zero, which is what makes it a gate
    expect(r.passing).toBe(false);
  });

  it("an EMPTY window that was actually read is a real answer, and scores full marks", () => {
    // Nothing recent to repeat is genuinely distinct. This must not be confused
    // with the outage case below.
    const empty = { topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [], available: true };
    const r = calculateReelQualityScore(sample(), 70, { recent: empty });
    expect(r.parts.find((p) => p.label === "Distinct from recent reels")?.points).toBe(5);
  });
});

describe("could-not-look is never spelled the same as nothing-to-repeat", () => {
  it("an unreadable history scores ZERO, not full marks", () => {
    const dead = { topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [], available: false };
    const r = calculateReelQualityScore(sample(), 70, { recent: dead });
    const part = r.parts.find((p) => p.label === "Distinct from recent reels");
    expect(part?.points, "a database outage scored as perfect originality").toBe(0);
    expect(part?.detail).toContain("unreadable");
  });

  it("but an outage never fires the duplicate gate - it must not start blocking publishes", () => {
    const dead = { topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [], available: false };
    const r = calculateReelQualityScore(sample(), 0, { recent: dead });
    expect(repeatedSignalCount(sample(), dead)).toBeNull();
    expect(r.hardGates.find((g) => g.name === "Not a duplicate of a recent reel")?.ok).toBe(true);
  });

  it("no context at all is reported as not-checked, and also never blocks", () => {
    const r = calculateReelQualityScore(sample(), 0);
    const part = r.parts.find((p) => p.label === "Distinct from recent reels");
    expect(part?.points).toBe(0);
    expect(part?.detail).toContain("no recent-signal context");
    expect(repeatedSignalCount(sample(), undefined)).toBeNull();
    expect(r.hardGates.find((g) => g.name === "Not a duplicate of a recent reel")?.ok).toBe(true);
  });

  it("the two nothings do not read alike", () => {
    const dead = { topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [], available: false };
    const a = calculateReelQualityScore(sample(), 70, { recent: dead }).parts.find((p) => p.label === "Distinct from recent reels")?.detail;
    const b = calculateReelQualityScore(sample(), 70).parts.find((p) => p.label === "Distinct from recent reels")?.detail;
    expect(a).not.toEqual(b);
  });
});
