/**
 * Why the daily reel kept coming out generic.
 *
 * Two defects in the miner, both measured against production 2026-09-07, and
 * they compounded:
 *
 *   1. `declinedWorkTopics` builds every topic from a per-category TEMPLATE, so
 *      four different parts share an eleven-word tail. The word-overlap dedup
 *      read them as one topic and suppressed ALL EIGHT declined-work
 *      candidates — four of them falsely, against unrelated parts.
 *   2. With the highest-weight source (34) silenced, the pick fell to
 *      `performance_signal` (30) and `coverage_gap` (16), which emit analytics
 *      THEME LABELS and bare SERVICE CATEGORIES. dailyReelPost takes
 *      renderable[0].topic, so the reel topic became the literal string
 *      "seasonal" — and reel job 1830003's stored topic is the single word
 *      "Engine".
 *
 * The strings below are verbatim from production.
 */
import { describe, expect, it } from "vitest";
import { isNearDuplicate, isScriptableTopic, mineTopicCandidates } from "@shared/contentTopicMiner";

const CONTROL_ARM =
  "the lower control arm: what a driver actually feels when it is going, and why this is the category we do not tell people to wait on";
const FRONT_HUB =
  "the front hub or bearing: what a driver actually feels when it is going, and why this is the category we do not tell people to wait on";
const TIE_ROD =
  "the tie rod end inner: what a driver actually feels when it is going, and why this is the category we do not tell people to wait on";
const CATALYTIC =
  "the catalytic converter: what it takes out with it when it fails, so the cheap repair does not become the expensive one";
const ALTERNATOR =
  "the alternator: what it takes out with it when it fails, so the cheap repair does not become the expensive one";

describe("template boilerplate must not mask a different part", () => {
  it("a different part sharing the template is NOT a duplicate", () => {
    // Production: all three were dropped against the control arm.
    expect(isNearDuplicate(FRONT_HUB, [CONTROL_ARM])).toBe(false);
    expect(isNearDuplicate(TIE_ROD, [CONTROL_ARM])).toBe(false);
    expect(isNearDuplicate(ALTERNATOR, [CATALYTIC])).toBe(false);
  });

  it("the SAME part is still a duplicate — this loosens nothing real", () => {
    expect(isNearDuplicate(CONTROL_ARM, [CONTROL_ARM])).toBe(true);
    expect(isNearDuplicate(CATALYTIC, [CATALYTIC])).toBe(true);
  });

  it("a reworded topic about the same subject is still caught", () => {
    expect(
      isNearDuplicate("the lower control arm: why the clunk matters", [CONTROL_ARM]),
    ).toBe(true);
  });

  it("free-form priors are compared whole, not truncated to a fragment", () => {
    // Only one side is templated, so head-to-head comparison would pit a
    // subject against a full sentence. Both must declare a separator.
    const freeForm = "You just hit a pothole on Euclid Ave and heard a clunk that made you wince.";
    expect(isNearDuplicate(CONTROL_ARM, [freeForm])).toBe(false);
    expect(isNearDuplicate("tread depth before wet season", [freeForm])).toBe(false);
  });
});

describe("a bare label is not a topic", () => {
  it("rejects the analytics theme labels that won the daily pick", () => {
    for (const label of ["seasonal", "community", "promo"]) {
      expect(isScriptableTopic(label), label).toBe(false);
    }
  });

  it("rejects bare service categories — 1830003's stored topic is literally \"Engine\"", () => {
    for (const cat of ["Engine", "Brakes", "Cooling", "Fluids", "Suspension"]) {
      expect(isScriptableTopic(cat), cat).toBe(false);
    }
    // Raised in review on #2167: a bare word count ACCEPTED this one, and
    // coverage_gap supplies it verbatim. On a day when declined/review/customer
    // are empty and the seasonal candidates are suppressed as recent, it scores
    // 16, outranks local_discovery at 15, and becomes the daily topic again.
    // Matching the enum exactly is precise where counting was a guess.
    expect(isScriptableTopic("Tires & Wheels")).toBe(false);
    expect(isScriptableTopic("Drivetrain")).toBe(false);
    expect(isScriptableTopic("Exhaust")).toBe(false);
  });

  it("accepts every real source's phrasing", () => {
    for (const topic of [
      CONTROL_ARM,
      FRONT_HUB,
      "brake wear after heavy driving",
      "tread depth before wet season",
      // Two-word topics from the existing suite's own fixtures — a first,
      // stricter bar rejected these and was wrong to.
      "brake noise",
      "exhaust work",
      "why a pothole hit on a Euclid road can bulge a tire sidewall without a visible flat",
      "how Cleveland road salt corrodes wheel rims and causes a slow leak at the bead",
    ]) {
      expect(isScriptableTopic(topic), topic).toBe(true);
    }
  });
});

describe("end to end through the miner", () => {
  const recentTopics = [CONTROL_ARM, CATALYTIC, "Engine", "Tread wear indicator bars - the built-in warning drivers miss"];

  it("distinct declined-work parts survive a recent reel about a different part", () => {
    const got = mineTopicCandidates({
      recentTopics,
      declinedWork: [CONTROL_ARM, FRONT_HUB, TIE_ROD, ALTERNATOR],
      topThemes: ["seasonal", "community", "promo"],
      underCoveredServices: ["Brakes", "Cooling"],
    });
    const topics = got.map((c) => c.topic);

    // The four false suppressions are gone...
    expect(topics).toContain(FRONT_HUB);
    expect(topics).toContain(ALTERNATOR);
    // ...while the genuinely-recent ones stay suppressed.
    expect(topics).not.toContain(CONTROL_ARM);
    expect(topics).not.toContain(CATALYTIC);
  });

  it("no bare label reaches the candidate list, so none can win the daily pick", () => {
    const got = mineTopicCandidates({
      recentTopics: [],
      topThemes: ["seasonal", "community", "promo"],
      underCoveredServices: ["Brakes", "Cooling", "Engine", "Tires & Wheels"],
      declinedWork: [FRONT_HUB],
    });
    for (const junk of ["seasonal", "community", "promo", "Brakes", "Cooling", "Engine", "Tires & Wheels"]) {
      expect(got.map((c) => c.topic)).not.toContain(junk);
    }
    // dailyReelPost takes renderable[0] — assert what it would actually get.
    expect(got[0]?.topic).toBe(FRONT_HUB);
    expect(got[0]?.source).toBe("declined_work");
  });

  it("declined work outranks every other source when it survives", () => {
    const got = mineTopicCandidates({
      recentTopics: [],
      declinedWork: [FRONT_HUB],
      localDiscoveryTopics: ["why a pothole hit on a Euclid road can bulge a tire sidewall without a visible flat"],
      seasonalConditions: ["brake wear after heavy driving"],
    });
    expect(got[0].source).toBe("declined_work");
  });
});

describe("canary — break each fix and prove the suite catches it", () => {
  /**
   * Both fixes are assertions about ABSENCE (a topic that should no longer be
   * dropped, a label that should no longer appear). Absence is exactly the
   * shape that scores green when the instrument is dead, so each is paired
   * with a positive control above: the same-part case must still dedup, and a
   * real topic must still be accepted.
   */
  it("the specificity bar is not vacuously true — it rejects something", () => {
    expect(isScriptableTopic("Engine")).toBe(false);
    expect(isScriptableTopic("brake noise")).toBe(true);
  });

  it("the dedup is not vacuously false — it still catches a real duplicate", () => {
    expect(isNearDuplicate(CONTROL_ARM, ["unrelated wiper blade streaking topic here"])).toBe(false);
    expect(isNearDuplicate(CONTROL_ARM, [CONTROL_ARM])).toBe(true);
  });
});
