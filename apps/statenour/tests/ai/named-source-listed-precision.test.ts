/**
 * The `listed` detector must not treat the model's own formatting as a claim
 * (2026-09-16, W10 · measured from production shadow verdicts).
 *
 * WHY THIS EXISTS. `NICK_EVIDENCE_ENFORCEMENT` is wired, unit-tested and OFF,
 * deliberately: `persist-assistant-turn.ts` says enforcement goes live "once
 * these numbers say the FP rate is tolerable", naming experiment E4. Nobody
 * had run E4. This file is the repair half of finally running it.
 *
 * WHAT THE SHADOW SAID (Neon, read-only, 91 turns 2026-09-11 → 2026-09-16):
 *
 *   verdict pass    57 · block 21 · repair 13
 *   of the 21 blocks, 20 carried unreceipted names, 4.86 names per turn
 *   78 flags over 73 distinct names
 *
 * And roughly half of those names were not resources. They were the
 * operator's own itineraries and gym protocols, which Nick writes as bolded
 * markdown list items — the exact shape `LISTED_TITLE_RE` matches, because
 * unlike the module's other two patterns it is anchored by NO resource noun.
 * Enforcement drops list items it cannot receipt, so arming the gate against
 * that detector would have deleted the operator's travel plan from the reply.
 *
 * The fixtures below are SYNTHETIC. The measured strings are the operator's
 * private chat content in a public repo, so this file reproduces their SHAPES
 * and records the counts, never the text:
 *
 *   14 · sentence with terminal punctuation
 *   10 · label-colon-value line
 *    2 · arrow itinerary leg
 *    1 · equation-style assertion
 *    2 * parenthetical day label
 *
 * The true-positive half is the load-bearing half. Capitalization density was
 * tried as a rule and REJECTED: sentence-case video titles are
 * indistinguishable from prose by capitalization, and it dropped three real
 * titles from the measured sample. The five shipped rules cost zero true
 * positives on that corpus, which is the property `keeps` asserts below.
 */
import { describe, expect, it } from "vitest";

import { detectNamedSources, isResourceTitle } from "@/lib/ai/chat/named-source-claims";

/** The reply shape that produced every false positive: a bolded list item. */
const asListItem = (s: string) => `Here is the plan:\n- **${s}** -- more detail here.`;

describe("isResourceTitle · rejects the shapes the shadow measured", () => {
  const rejects: Array<[string, string]> = [
    ["sentence with terminal punctuation", "Eat real food in the next 30 minutes."],
    ["terminal question mark", "Is that place too far?"],
    ["equation-style assertion", "Boredom = a drift signal"],
    ["arrow itinerary leg", "Brooklyn Bridge -> Dumbo"],
    ["unicode arrow itinerary leg", "High Line → Chelsea Market"],
    ["label colon value", "Lunch: Some Diner"],
    ["label with an empty value", "Week after:"],
    ["begins mid-sentence", "of Something"],
  ];
  for (const [shape, text] of rejects) {
    it(`rejects a ${shape}`, () => {
      expect(isResourceTitle(text), text).toBe(false);
    });
  }
});

describe("isResourceTitle · keeps every real title shape in the measured sample", () => {
  const keeps: Array<[string, string]> = [
    ["single-word channel handle", "Mindplicit"],
    ["two-word channel name", "Huberman Lab"],
    ["camel-case handle", "HealthyGamerGG"],
    ["hyphenated brand", "TED-Ed"],
    ["title with a connective", "Like Stories of Old"],
    // The three that a capitalization-density rule would have killed.
    ["sentence-case video title", "How to read body language — FBI agent explains"],
    ["sentence-case title with a clause", "How to build unshakeable confidence — actual framework"],
    ["long sentence-case title", "The life advice thread that actually works"],
    // A real subtitle: a colon is fine when the left side is a real title.
    ["book title with a genuine subtitle", "Never Split the Difference: Negotiating As If Your Life Depended On It"],
  ];
  for (const [shape, text] of keeps) {
    it(`keeps a ${shape}`, () => {
      expect(isResourceTitle(text), text).toBe(true);
    });
  }
});

describe("detectNamedSources · the guard changes what reaches the gate", () => {
  it("an itinerary written as bolded list items produces NO named claims", () => {
    const reply = [
      "Here is Saturday:",
      "- **Morning: The Museum** -- get there early.",
      "- **Lunch: Some Diner** -- ten minute walk.",
      "- **High Line → Chelsea Market** -- do it in that order.",
      "- **Hydrate hard day-of.** -- three bottles minimum.",
    ].join("\n");
    expect(detectNamedSources(reply)).toEqual([]);
  });

  it("a recommendation list still produces one claim per title", () => {
    // The canonical shape from tests/ai/gate-enforcement.test.ts, which must
    // keep working: enforcement strips the entries no receipt supports.
    const reply = [
      "Here are two worth your time:",
      "- **Daily Stoic** -- the accessible entry point.",
      "- **Einzelganger** -- the philosophical end of it.",
    ].join("\n");
    expect(detectNamedSources(reply).map((c) => c.name).sort()).toEqual(["Daily Stoic", "Einzelganger"]);
  });

  it("a coaching plan and a recommendation in ONE reply keep only the recommendation", () => {
    // The mixed turn is the realistic one, and the reason a whole-reply
    // verdict was wrong: one bolded plan line used to convict the whole turn.
    const reply = [
      "Two things.",
      "- **Reset between sets.** -- no phone.",
      "- **Modern Observer** -- worth subscribing to.",
    ].join("\n");
    expect(detectNamedSources(reply).map((c) => c.name)).toEqual(["Modern Observer"]);
  });

  it("the guard applies to the LISTED pattern only — an anchored claim still fires", () => {
    // NAME_THEN_NOUN_RE and NOUN_THEN_NAME_RE are anchored by an explicit
    // resource noun, so they never needed this and must not lose it. A
    // sentence-ending name would be rejected by isResourceTitle, which is
    // exactly why the guard must not be applied globally.
    const claims = detectNamedSources("You should listen to the Acquired podcast.");
    expect(claims.map((c) => c.name)).toContain("Acquired");
  });

  it("instrument control · the same list items WOULD be claims without the guard", () => {
    // Without this, every assertion above would also pass if the detector
    // silently stopped matching list items altogether. Proves the pattern is
    // still live and that it is the GUARD doing the filtering.
    const reply = "Here are two:\n- **Daily Stoic** -- one.\n- **Lunch: Some Diner** -- two.";
    const names = detectNamedSources(reply).map((c) => c.name);
    expect(names, "the listed pattern must still fire on a real title").toContain("Daily Stoic");
    expect(names, "and must not fire on the label beside it").not.toContain("Lunch: Some Diner");
  });
});

describe("isResourceTitle - rejects the model's OWN label shapes (2026-09-22 shadow read)", () => {
  // The 52 post-fix shadow blocks were read by hand: the LISTED pattern fired
  // on the model's own bolded option labels, imperative steps, comparisons,
  // price and duration assertions, and prose lines - roughly 19 of 27
  // named-claim blocks, while the real fabrications (venue and platform lists
  // asserted as "verified" with no tool) were 8. Production shapes, names
  // swapped. Measured over the 24 blocking turns with unreceipted names: these
  // rules drop 87 names to 49 and 24 blocking turns to 16, with every
  // protected title above still kept.
  const rejects: Array<[string, string]> = [
    ["alternatives with a slash", "Low-effort / solo recharge"],
    ["alternatives with a plus", "Rent + police pressure"],
    ["a comparison", "Espresso > drip"],
    ["a versus pair", "Edge vs Brooklyn Bridge sunrise"],
    ["an imperative step", "Drive to Bay Ridge, BK"],
    ["a negated imperative step", "NOT park on Victory Blvd itself"],
    ["an -ing step", "Driving from the hotel to the ferry"],
    ["a re- imperative", "Re-queue the deep research task"],
    ["a lowercase parenthetical gloss", "Great-aunt (retired)"],
    ["a price assertion", "Helicopter tour runs about $150 to $500+"],
    ["a duration label", "NJ corridor - 20-35 min south"],
    ["a modal-verb prose line", "Mom will want something just for you"],
    ["a two-word sentence-case label", "Manhattan walk"],
    ["a three-word sentence-case label", "Vetted companion platforms"],
    ["a long prose line with function words", "Negotiate direct with vendors outside the shop"],
  ];
  for (const [shape, text] of rejects) {
    it(`rejects ${shape}`, () => {
      expect(isResourceTitle(text), text).toBe(false);
    });
  }

  // The real-resource shapes from the same read must survive: a proper-noun
  // venue, a name with a number, a lowercase connective, a trailing common
  // noun, a domain. Three-word titles starting with a verb ("Back to Black")
  // are kept on purpose - the imperative rule needs four words.
  const keeps: Array<[string, string]> = [
    ["a two-word venue", "Blue Note"],
    ["a venue with a number", "Suite 16"],
    ["a title with a lowercase connective", "Eye of RA"],
    ["a three-word name ending in a common noun", "Governors Island ferry"],
    ["a domain", "Ahrefs.com"],
    ["a three-word title opening with a verb", "Back to Black"],
  ];
  for (const [shape, text] of keeps) {
    it(`keeps ${shape}`, () => {
      expect(isResourceTitle(text), text).toBe(true);
    });
  }

  it("a stopword with trailing punctuation is still a stopword: a bolded 'Yes, ...' sentence is not a claim", () => {
    const reply = "Two things to flag:\n1. **Yes, your tool set rotates per turn** - what I had earlier I don't always have now.";
    expect(detectNamedSources(reply)).toEqual([]);
  });
});
