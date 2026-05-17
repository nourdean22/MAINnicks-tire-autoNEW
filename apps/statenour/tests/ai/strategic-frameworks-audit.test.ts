/**
 * Strategic Frameworks · false-fire audit
 *
 * Tests phrases that should NOT fire any framework, especially as the
 * registry grows past 50 lenses where regex collisions become more
 * likely. Every failure here is a real false-fire risk → either tighten
 * the trigger, add an anti-trigger, or split the regex.
 *
 * Versions ·
 *   v10.0.244 · 19 cases · initial audit · 7 false-fires blocked
 *   v10.0.248 · 35+ cases · expanded audit at 52-lens scale
 *
 * Audit-only file · separate from the main test surface so additions
 * here are clearly false-fire defense vs. positive matching.
 */
import { describe, it, expect } from "vitest";
import {
  pickFrameworks,
  hasBusinessIntent,
} from "@/lib/ai/strategic-frameworks";

describe("audit · idiomatic / non-business phrases must NOT fire frameworks", () => {
  it.each([
    // funnel · cake / kitchen / plumbing
    "what's the best funnel cake recipe",
    "I need a new kitchen funnel",
    "the funnel of the wine bottle is clogged",
    // bottleneck · physical
    "the bottleneck of my wine bottle is broken",
    "this canyon narrows into a real bottleneck",
    // journey · physical
    "the customer journey through downtown was nice",
    "we had a long journey to get here",
    // share · vision / sight
    "share your vision for the trip",
    "I love the view from up here",
    // stuck · physical
    "we're stuck in traffic",
    "I'm stuck on this jigsaw puzzle",
    // step · staircase
    "let me help you break this down step by step",
    "watch your step on the staircase",
    // brand · cattle
    "branding the cattle this weekend",
    // network · physical
    "my home network is down",
    "the network cable came loose",
    // pricing · ticket / admission idioms
    "what's the price of admission to the founder retreat",
    "ticket prices for the show",
    // v10.0.248 · expanded audit at 52-lens scale
    // hire / fire · idiomatic
    "fire up the grill tonight",
    "hire a uber to the airport",
    // strategy / strategic · over-broad if any lens uses it
    "what's a good chess strategy",
    "the strategy for solving this puzzle",
    // launch · idiomatic
    "launch the chrome browser from a script",
    "spacex launch is tomorrow",
    // brand · branding · identity / cattle
    "branding the cattle this weekend",
    "what's a good brand of milk",
    // model · plane / fashion / scale model
    "what model of car do you drive",
    "this is a model airplane",
    // grow · plants
    "how do I grow tomatoes in winter",
    "the plant is growing well",
    // value · subjective wellness
    "I value my family above all",
    "the value of friendship",
    // metrics · sports / health
    "what are the body composition metrics",
    "track my running metrics",
    // share · divide / show
    "share the pizza with the kids",
    "share your screen on zoom",
    // path · physical
    "the path through the forest is muddy",
    // 10x · arbitrary multiplier idiom
    "this engine is 10x more powerful than the old one",
  ])("does NOT fire on idiomatic '%s'", (phrase) => {
    const matches = pickFrameworks(phrase);
    if (matches.length > 0) {
      // Surface which framework misfired so the failure is debuggable
      throw new Error(
        `False-fire on "${phrase}" · fired: ${matches
          .map((m) => `${m.framework.id}@${m.score}`)
          .join(", ")} · matched: ${JSON.stringify(matches.map((m) => m.matched))}`,
      );
    }
    expect(matches).toEqual([]);
  });

  it("hasBusinessIntent stays false on greetings + meta", () => {
    expect(hasBusinessIntent("hi")).toBe(false);
    expect(hasBusinessIntent("ok")).toBe(false);
    expect(hasBusinessIntent("thanks")).toBe(false);
    expect(hasBusinessIntent("got it")).toBe(false);
    expect(hasBusinessIntent("nevermind")).toBe(false);
  });
});
