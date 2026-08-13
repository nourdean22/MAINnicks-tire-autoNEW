import { describe, it, expect } from "vitest";
import { checkReviewReply } from "@shared/reviewReplyQa";
import { MANIFEST, runDailyReelPost } from "./dailyReelPost";

describe("dailyReelPost", () => {
  it("covers reels 5-30 in order (26 reels)", () => {
    expect(MANIFEST.length).toBe(26);
    expect(MANIFEST[0].reel).toBe(5);
    expect(MANIFEST.at(-1)!.reel).toBe(30);
    expect(MANIFEST.map((m) => m.reel)).toEqual(Array.from({ length: 26 }, (_, i) => i + 5));
  });

  it("every caption passes the reel claim-safety gate (zero blockers, incl. no-price)", () => {
    // publishToSocial gates reels on checkReviewReply(...).filter(block). A blocked
    // caption would refuse the post and stall the queue — so all 26 must be clean.
    for (const { reel, caption } of MANIFEST) {
      const blockers = checkReviewReply(caption).filter((f) => f.severity === "block");
      expect(blockers, `reel${reel} blocked: ${JSON.stringify(blockers)}`).toEqual([]);
    }
  });

  it("is a hard no-op when REEL_AUTOPOST_ENABLED is not 'true'", async () => {
    const prev = process.env.REEL_AUTOPOST_ENABLED;
    delete process.env.REEL_AUTOPOST_ENABLED;
    const r = await runDailyReelPost();
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toContain("disabled");
    if (prev !== undefined) process.env.REEL_AUTOPOST_ENABLED = prev;
  });
});

// NT-001 · the shadow-judge input builder must return something judgeable for
// EVERY payload shape — a 70KB brief, a truncated one, or garbage. A throw
// here would look like "judge lane flaky" while actually being a JSON edge.
import { buildReelShadowJudgeInput } from "./dailyReelPost";

describe("buildReelShadowJudgeInput (shadow judge, log-only)", () => {
  const base = { id: 42, briefId: "autopost-2026-08-13", caption: "Hook line\nBody line #tags" };

  it("uses the brief's topic + visual identity when the payload parses", () => {
    const input = buildReelShadowJudgeInput({
      ...base,
      payload: JSON.stringify({ topic: "Brake squeal warning", archetype: "proof", objectCharacter: "CHECK-01" }),
    });
    expect(input.concept.title).toBe("Brake squeal warning");
    expect(input.concept.visualIdea).toBe("proof · CHECK-01");
    expect(input.concept.hook).toBe("Hook line");
    expect(input.campaignAsk).toContain("job 42");
  });

  it("NEVER throws on unparseable payload — judges on the caption alone", () => {
    const input = buildReelShadowJudgeInput({ ...base, payload: "{truncated garbage" });
    expect(input.concept.title).toBe("autopost-2026-08-13");
    expect(input.concept.coreIdea).toContain("Hook line");
  });

  it("survives a null payload and an empty caption (worst assembled row)", () => {
    const input = buildReelShadowJudgeInput({ id: 7, briefId: "autopost-x", payload: null, caption: "" });
    expect(input.concept.title).toBe("autopost-x");
    // Empty caption falls back to the title so the judge always has a text.
    expect(input.concept.coreIdea).toBe("autopost-x");
    expect(input.concept.hook.length).toBeGreaterThan(0);
  });
});
