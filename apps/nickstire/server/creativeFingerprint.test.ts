/**
 * Creative fingerprint — semantic novelty that can say WHY.
 *
 * The pair this exists to catch, and which every existing guard misses:
 *
 *   "What potholes do to your alignment"
 *   "Why your steering changed after that pothole"
 *
 * `conceptKey` equality: different. `isNearDuplicate` word-overlap: they share
 * almost no long words, so also different. To a viewer they are the same post.
 *
 * The FALSE-POSITIVE half matters more than the true-positive half. This shop's
 * revenue IS brakes and suspension; a guard that bans mentioning brakes twice
 * would be turned off within a week, and then it protects nothing.
 */
import { describe, expect, it } from "vitest";
import { assessNovelty, fingerprint } from "../shared/creativeFingerprint";

describe("fingerprint", () => {
  it("resolves the SPECIFIC subject, not the general one", () => {
    // "control arm" must beat a bare "arm"; "wheel bearing" must beat "wheel".
    expect(fingerprint("the lower control arm and what it does").subject).toBe("control arm");
    expect(fingerprint("a front wheel bearing going bad").subject).toBe("wheel bearing");
    // A piece about tire wear is not merely "tires".
    expect(fingerprint("that wear pattern on the tread tells a story").subject).toBe("tire wear");
  });

  it("classifies the rhetorical move", () => {
    expect(fingerprint("the tire isn't always why the steering wheel shakes").claimShape).toBe("hidden_cause");
    expect(fingerprint("new tires won't fix bad alignment").claimShape).toBe("myth_bust");
    expect(fingerprint("why we won't sell you tires before checking this").claimShape).toBe("refusal");
    expect(fingerprint("one sound, three completely different problems").claimShape).toBe("symptom_decode");
  });

  it("returns unclassified rather than guessing", () => {
    const f = fingerprint("hello there everyone");
    expect(f.subject).toBe("unclassified");
    expect(f.claimShape).toBe("unclassified");
  });
});

describe("assessNovelty — the cousins every existing guard misses", () => {
  it("★ catches creative twins that share almost no words", () => {
    const v = assessNovelty("Why your steering changed after that pothole", [
      "What potholes do to your alignment",
    ]);
    expect(v.isCousin).toBe(true);
    expect(v.collisions.some((c) => c.startsWith("subject:"))).toBe(true);
  });

  it("names WHICH dimensions collided — a bare score is unactionable", () => {
    const v = assessNovelty("the brake pedal shakes but the pad may not be the problem", [
      "your brake vibration isn't always the rotor",
    ]);
    expect(v.collisions.length).toBeGreaterThan(0);
    expect(v.collisions.join(" ")).toMatch(/subject:brakes/);
  });

  it("suggests a concrete axis to change, not 'be more original'", () => {
    const v = assessNovelty("Why your steering changed after that pothole", [
      "What potholes do to your alignment",
    ]);
    expect(v.suggestions.length).toBeGreaterThan(0);
    expect(v.suggestions[0]).toMatch(/claim shape/);
  });

  // ── the false-positive half ──

  it("SAME SUBJECT, different claim shape → NOT a cousin", () => {
    // A shop whose revenue is brakes must be able to run brakes repeatedly.
    const v = assessNovelty("we won't sell you brakes before we show you the rotor", [
      "your brake vibration isn't always the rotor",
    ]);
    expect(v.isCousin).toBe(false);
  });

  it("SAME claim shape, different subject → NOT a cousin", () => {
    // "hidden cause" is a FORMAT the page runs, not a repetition.
    const v = assessNovelty("the tire isn't always why the steering shakes", [
      "the check engine light isn't the diagnosis",
    ]);
    expect(v.isCousin).toBe(false);
  });

  it("an empty history is never a cousin", () => {
    expect(assessNovelty("anything at all", []).isCousin).toBe(false);
    expect(assessNovelty("anything at all", []).similarity).toBe(0);
  });

  it("two unclassified pieces do not collide on being unclassified", () => {
    // Otherwise everything the vocabulary does not cover becomes a duplicate of
    // everything else it does not cover, and the guard blocks the whole feed.
    const v = assessNovelty("some entirely novel thing", ["another entirely novel thing"]);
    expect(v.isCousin).toBe(false);
  });

  it("reports the nearest prior so the operator can see the call", () => {
    const v = assessNovelty("Why your steering changed after that pothole", [
      "unrelated piece about oil",
      "What potholes do to your alignment",
    ]);
    expect(v.nearest).toBe("What potholes do to your alignment");
  });

  it("similarity is bounded and rises with collisions", () => {
    const weak = assessNovelty("the check engine light isn't the diagnosis", ["what a water pump actually does"]);
    const strong = assessNovelty("What potholes do to your alignment", ["What potholes do to your alignment"]);
    expect(strong.similarity).toBeGreaterThan(weak.similarity);
    expect(strong.similarity).toBeLessThanOrEqual(1);
  });
});
