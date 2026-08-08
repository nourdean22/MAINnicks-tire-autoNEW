/**
 * WIRING tests — the modules must be CALLED, not merely correct.
 *
 * Both `declinedWorkTopics` and `creativeFingerprint` shipped fully tested and
 * verified against prod, with **zero importers**. That is the same
 * BUILT-TESTED-UNWIRED pattern recorded in ROS-092 (`higgsfieldSessionHealth`
 * was built, tested, and wired to one display surface and no decision — five
 * days later a revoked session took reels dark because nothing consulted it)
 * and in the statenour deep-upgrade gate, which found it four times.
 *
 * A behaviour test cannot catch it: every unit test passed while nothing called
 * the code. So these assert the CONNECTIONS, in the same spirit as the
 * source-assertions in reelFreeLaneFallback.test.ts — "a correct predicate that
 * nothing calls would leave the account just as dark."
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mineTopicCandidates, type TopicSignals } from "../shared/contentTopicMiner";

const read = (rel: string): string => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("declined work reaches the topic miner", () => {
  it("the IO gatherer actually calls fetchDeclinedWorkTopics", () => {
    const src = read("server/services/contentTopicSignals.ts");
    expect(src).toContain("fetchDeclinedWorkTopics");
    expect(src).toMatch(/signals\.declinedWork\s*=/);
  });

  it("a gather failure degrades the feed loudly instead of throwing", () => {
    // The other sources must still produce candidates without this one.
    const src = read("server/services/contentTopicSignals.ts");
    expect(src).toMatch(/failed\.push\("declined_work"\)/);
  });

  it("declined work outranks every other source", () => {
    // It is the only source that is un-generic by construction, which is the bar
    // HARD_REJECT_RULES[0] sets.
    const signals: TopicSignals = {
      declinedWork: ["the lower control arm: what a driver actually feels when it is going"],
      topThemes: ["winter tire pressure basics"],
      customerQuestions: ["how much is an alignment"],
    };
    const out = mineTopicCandidates(signals);
    expect(out[0].source).toBe("declined_work");
  });

  it("emits nothing when there is no declined work — no phantom candidate", () => {
    const out = mineTopicCandidates({ topThemes: ["winter tire pressure basics"] });
    expect(out.every((c) => c.source !== "declined_work")).toBe(true);
  });

  it("a declined-work topic still routes to a franchise and can be blocked like any other", () => {
    const out = mineTopicCandidates({ declinedWork: ["the catalytic converter: what it takes out with it"] });
    expect(out).toHaveLength(1);
    expect(out[0].franchiseId).toBeTruthy();
    expect(out[0].reasons.join(" ")).toContain("declined_work");
  });
});

describe("the deterministic novelty floor is wired into the autopost eval", () => {
  const src = read("server/services/igAutopost.ts");

  it("evalCaption consults assessNovelty", () => {
    expect(src).toContain("assessNovelty");
    expect(src).toContain("creativeFingerprint");
  });

  it("★ it can only LOWER the LLM score, never raise it", () => {
    // Agreement with the model is not evidence the model was right, so there is
    // nothing to award. Only Math.min may appear on this path.
    expect(src).toMatch(/novelty = Math\.min\(llmNovelty/);
    expect(src).not.toMatch(/novelty = Math\.max\(llmNovelty/);
  });

  it("a failing novelty check does not fail the post", () => {
    // The cap is a quality guard, not a correctness gate — an unavailable check
    // must leave the LLM score standing and say so.
    expect(src).toMatch(/deterministic novelty check unavailable/);
  });

  it("the cap is recorded in the notes, so a capped post is visible in the log", () => {
    expect(src).toContain("novelty capped");
  });
});
