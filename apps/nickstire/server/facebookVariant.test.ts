/**
 * facebookVariant — deterministic IG→FB caption transform.
 * Positive control: the IG caption below has a 6-tag wall, "link in bio" and
 * "DM us"; the untransformed caption fails every assertion in the first test.
 */
import { describe, expect, it } from "vitest";
import { buildFacebookCaption, deriveQuestion, MAX_FB_HASHTAGS } from "./services/facebookVariant";

const IG = `Brake pads don't squeal for fun.
That metal tab is a wear indicator telling you the pad is nearly gone. Grinding means it's already gone.

Link in bio for the check. DM us with your year/make.

#brakes #cleveland #autorepair #euclid #mechanic #brakerepair`;

describe("buildFacebookCaption", () => {
  it("removes the hashtag wall, keeps at most two tags, rewrites IG mechanics, adds a question and sign-off", () => {
    const v = buildFacebookCaption({ igCaption: IG, thesis: "A squeal is a schedule, a grind is a bill" });
    const tagCount = (v.caption.match(/#\w+/g) ?? []).length;
    expect(tagCount).toBeLessThanOrEqual(MAX_FB_HASHTAGS);
    expect(v.hashtags).toEqual(["brakes", "cleveland"]);
    expect(v.caption).not.toMatch(/link in bio/i);
    expect(v.caption).not.toMatch(/\bdm us\b/i);
    expect(v.caption).toContain("nickstire.org");
    expect(v.caption).toContain("message the Page");
    expect(v.caption.startsWith("A squeal is a schedule, a grind is a bill.")).toBe(true);
    expect(v.caption).toContain(v.question);
    expect(v.question.endsWith("?")).toBe(true);
    expect(v.caption).toContain("17625 Euclid Ave");
    expect(v.caption).toContain("(216) 862-0005");
    // longer and conversational: the FB body carries more prose than the IG body did
    const igBody = IG.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(v.caption.length).toBeGreaterThan(igBody.length);
    expect(v.notes.some((n) => n.startsWith("removed 1 hashtag-wall line"))).toBe(true);
  });

  it("is deterministic and never produces a hashtag wall even from a wall-only caption", () => {
    const a = buildFacebookCaption({ igCaption: IG, topic: "brakes" });
    const b = buildFacebookCaption({ igCaption: IG, topic: "brakes" });
    expect(a).toEqual(b);
    const wallOnly = buildFacebookCaption({ igCaption: "#tires #cleveland #euclid #snow" });
    expect(wallOnly.caption).not.toMatch(/#\w+ #\w+ #\w+/);
    expect(wallOnly.question.length).toBeGreaterThan(10);
  });

  it("uses an explicit question when given and does not duplicate a thesis the body already opens with", () => {
    const v = buildFacebookCaption({ igCaption: "Tires age out before they wear out. Check the DOT date.", thesis: "Tires age out before they wear out", question: "What year is stamped on yours?" });
    expect(v.question).toBe("What year is stamped on yours?");
    expect(v.caption.indexOf("Tires age out")).toBe(v.caption.lastIndexOf("Tires age out"));
  });

  it("deriveQuestion keys off the topic lexicon with a default", () => {
    expect(deriveQuestion("worn tread on the fronts")).toMatch(/tires/i);
    expect(deriveQuestion("nothing automotive here")).toMatch(/car noise/i);
    expect(deriveQuestion("", "battery")).toMatch(/start/i);
  });
});
