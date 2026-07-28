/**
 * Greene · Mastery Book V creative lenses · 2026-07-27.
 *
 * Eight of the nine creative-active strategies as strategic-framework
 * lenses. The registry's other 52 are business-ANALYSIS lenses (evaluate a
 * market, a price, a decision); these are creative-PROCESS lenses (how to
 * make original work) — a genuinely absent axis.
 *
 * "The Open Field" is deliberately NOT a lens: it is the same argument as
 * `blue-ocean` (uncontested space, refuse the incumbents' scoreboard), and
 * a near-duplicate would split trigger matches and dilute both. The last
 * test pins that routing so the decision is visible rather than looking
 * like an oversight.
 *
 * A lens is only worth adding if it fires when it should AND stays quiet
 * when it shouldn't, so both directions are asserted.
 */

import { describe, expect, it } from "vitest";

import { pickFrameworks } from "@/lib/ai/strategic-frameworks";

const idsFor = (msg: string) => pickFrameworks(msg, 5).map((m) => m.framework.id);

const CASES: Array<{ id: string; msg: string }> = [
  {
    id: "authentic-voice",
    msg: "every caption I write sounds like every other shop — how do I find my own voice?",
  },
  {
    id: "fact-of-great-yield",
    msg: "car count went up but revenue dropped and the numbers don't match, I can't explain it",
  },
  {
    id: "mechanical-intelligence",
    msg: "should I spec it out first or just build it — this all looks right on paper",
  },
  {
    id: "natural-powers",
    msg: "everyone says I should just get a dev job, am I wasting my time on the shop?",
  },
  {
    id: "the-high-end",
    msg: "I spent all day polishing this refactor and I'm deep in the weeds, does this even matter",
  },
  {
    id: "evolutionary-hijack",
    msg: "should we rebuild the follow-up system from scratch or repurpose the existing SMS pipeline",
  },
  {
    id: "dimensional-thinking",
    msg: "I'm stuck on this problem and keep coming at it from one angle, what am I missing",
  },
  {
    id: "alchemical-creativity",
    msg: "been at this for hours and I'm creatively blocked, can't figure it out",
  },
];

describe("Book V creative lenses · fire on the situation they describe", () => {
  it.each(CASES)("$id fires for its own case", ({ id, msg }) => {
    expect(idsFor(msg)).toContain(id);
  });
});

describe("Book V creative lenses · stay quiet when they should", () => {
  it("does not fire the-high-end on high-end as a market tier", () => {
    // antiTrigger case — "high-end" is overwhelmingly a pricing/segment
    // word in this business, and Greene's sense is the opposite of that.
    expect(
      idsFor("should we go after high-end customers with a premium detailing package?"),
    ).not.toContain("the-high-end");
  });

  it("does not fire authentic-voice on literal voice features", () => {
    // antiTrigger case — this repo ships a voice agent; "voice" alone is
    // not a register question.
    expect(
      idsFor("the voice agent keeps dropping the call, can we check the tts pipeline?"),
    ).not.toContain("authentic-voice");
  });

  it("leaves plain operational questions alone", () => {
    const ids = idsFor("what time does the shop close on saturday?");
    for (const c of CASES) expect(ids).not.toContain(c.id);
  });
});

describe("The Open Field routes to blue-ocean rather than duplicating it", () => {
  it("matches blue-ocean and adds no open-field lens", () => {
    const ids = idsFor(
      "every shop here competes on price, the market is crowded — how do I stop competing on their terms?",
    );
    expect(ids).toContain("blue-ocean");
    expect(ids).not.toContain("open-field");
    expect(ids).not.toContain("the-open-field");
  });
});

// ── 2026-07-28 · review regression · natural-powers over-matching ──
// The trigger was `\b(am i|are we)\s+wasting\b`, which fired on spend and
// inventory questions and then injected advice about working against
// one's natural grain instead of analyzing the spend. Narrowed to require
// the wasted thing to be the operator's own time/life/path.
describe("natural-powers · does not hijack resource questions", () => {
  it.each([
    "am i wasting money on google ads?",
    "are we wasting inventory on slow-moving tires?",
    "am i wasting budget on this campaign",
    "are we wasting parts on comebacks",
  ])("stays quiet for: %s", (msg) => {
    expect(idsFor(msg)).not.toContain("natural-powers");
  });

  it.each([
    "am i wasting my time on the shop when everyone says i should get a dev job",
    "are we wasting years going against my grain here",
  ])("still fires for vocation waste: %s", (msg) => {
    expect(idsFor(msg)).toContain("natural-powers");
  });
});
