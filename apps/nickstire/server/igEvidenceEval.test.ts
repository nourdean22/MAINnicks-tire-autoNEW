/**
 * Evidence evaluation set — WEAK INPUT vs RESOLVED EVIDENCE.
 *
 * SCOPE, STATED HONESTLY. This measures what the generator and the gate can
 * SEE, not the text a model returns. It makes no model call: generation runs on
 * a funded provider, and a paid call is an external side effect this work is not
 * authorized to trigger. So the claim under test is deliberately narrower than
 * "the output got better" — it is:
 *
 *   the specifics available to the writer, and the gate's ability to tell
 *   grounded from ungrounded, both changed materially.
 *
 * That is the falsifiable half. The prior architecture could not have passed
 * these assertions at any prompt-quality level, because the facts never reached
 * the prompt and the gate only ever saw a boolean — which is the whole reason
 * "optimize the prompt harder" was the wrong instinct.
 */
import { describe, expect, it } from "vitest";
import { assessEvidence, evidenceDirective, type EvidenceFact } from "../shared/evidenceSufficiency";
import { evaluateInstagramDraft } from "./services/instagramStudio";

/** Representative cases, one per source class that can resolve a real record. */
const CASES: Array<{
  name: string;
  sourceType: string;
  /** What the operator could supply BEFORE: a category plus retyped prose. */
  weakDetail: string;
  /** What resolution now returns. Shapes mirror resolveSourceProvenance's
   *  builders exactly; the VALUES are illustrative, not production rows. */
  resolved: EvidenceFact[];
}> = [
  {
    name: "review",
    sourceType: "review",
    weakDetail: "good review",
    resolved: [
      { key: "review_quote", label: "Review, in the customer's words", value: "They showed me exactly why the tire could not be safely patched instead of just selling me a new one", role: "quote", basis: "recorded" },
      { key: "reviewer", label: "Reviewer", value: "Maria", role: "anchor", basis: "recorded" },
      { key: "rating", label: "Star rating", value: "5 of 5", role: "magnitude", basis: "recorded" },
      { key: "review_date", label: "Review date", value: "2026-08-14", role: "temporal", basis: "recorded" },
    ],
  },
  {
    name: "declined_work (ALG — decline is INFERRED)",
    sourceType: "declined_work",
    weakDetail: "someone skipped brakes",
    resolved: [
      { key: "vehicle", label: "Vehicle", value: "2018 Ford Escape", role: "anchor", basis: "recorded" },
      { key: "quoted_service", label: "Service quoted", value: "front brake pads and rotors", role: "anchor", basis: "recorded" },
      { key: "quoted_on", label: "Quoted on", value: "2026-03-04", role: "temporal", basis: "recorded" },
      { key: "quoted_amount", label: "Amount quoted", value: "$486", role: "magnitude", basis: "recorded" },
      { key: "not_yet_returned", label: "Status", value: "no matching paid invoice — work not recorded as done", role: "context", basis: "inferred" },
    ],
  },
  {
    name: "special_offer",
    sourceType: "special_offer",
    weakDetail: "we have a deal on oil changes",
    resolved: [
      { key: "offer_title", label: "Offer", value: "Synthetic oil change", role: "anchor", basis: "recorded" },
      { key: "discount", label: "Discount", value: "$20 off", role: "magnitude", basis: "recorded" },
      { key: "offer_ends", label: "Offer ends", value: "2026-08-31", role: "temporal", basis: "recorded" },
    ],
  },
];

const draftBase = {
  format: "post" as const,
  caption: "Your tires talk before they fail. Here is what to listen for, and when to just stop in.",
  headline: "What a failing tire sounds like",
  subheadline: "Two minutes, no appointment",
  artDirection: "",
  cta: "Walk in today",
  carouselSlides: [] as Array<{ headline: string; body: string }>,
};

const grounding = (facts: EvidenceFact[], detail: string, sourceType: string) =>
  evaluateInstagramDraft({
    ...draftBase,
    source: { type: sourceType as never, detail, evidenceStatus: facts.length ? "verified" : "operator_context" },
    evidenceFacts: facts,
  }).dimensions.find((d) => d.key === "source_grounding")!;

describe("evidence delivered to the generator", () => {
  it.each(CASES)("$name — resolution supplies publishable specifics where prose supplied none", (c) => {
    const weak = assessEvidence([], c.weakDetail);
    const strong = assessEvidence(c.resolved, c.weakDetail);

    // BEFORE: zero recorded facts, regardless of how much the operator typed.
    expect(weak.sufficiency).not.toBe("sufficient");

    // AFTER: at least two recorded, publishable specifics.
    const recorded = c.resolved.filter((f) => f.basis === "recorded");
    expect(recorded.length).toBeGreaterThanOrEqual(2);
    expect(strong.sufficiency).toBe("sufficient");
    expect(strong.groundingScore).toBeGreaterThan(weak.groundingScore);
  });

  it.each(CASES)("$name — the directive flips from 'stay general' to 'use only these facts'", (c) => {
    expect(evidenceDirective(assessEvidence([], c.weakDetail))).toMatch(/Invent NOTHING|GENERAL/);
    expect(evidenceDirective(assessEvidence(c.resolved, c.weakDetail))).toMatch(/add NO detail that is not among them/);
  });
});

describe("the gate can now discriminate — it previously could not", () => {
  it.each(CASES)("$name — grounded scores strictly higher than retyped prose", (c) => {
    const weak = grounding([], c.weakDetail, c.sourceType);
    const strong = grounding(c.resolved, c.weakDetail, c.sourceType);
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it("the OLD rule would have scored these two IDENTICALLY — the regression this closes", () => {
    // Old: `input.source.detail?.trim() || recordId?.trim() ? 8 : 6`. Both cases
    // below have non-empty detail, so both scored 8 and neither warned. Any
    // difference now is proof the dimension reads evidence rather than string
    // non-emptiness.
    const c = CASES[0];
    const weak = grounding([], c.weakDetail, "season_weather");
    const strong = grounding(c.resolved, c.weakDetail, "season_weather");
    expect(weak.score).not.toBe(strong.score);
  });
});

describe("inferred facts are never laundered into assertable truth", () => {
  it("the ALG declined case cannot reach `sufficient` on its inferred fact alone", () => {
    const inferredOnly = CASES[1].resolved.filter((f) => f.basis === "inferred");
    expect(assessEvidence(inferredOnly, "").sufficiency).not.toBe("sufficient");
  });

  it("the ALG case reports the decline as inferred even when it IS sufficient overall", () => {
    // It reaches sufficiency on vehicle+date, which are recorded — but the
    // decline itself must still be flagged for qualification.
    const a = assessEvidence(CASES[1].resolved, "");
    expect(a.sufficiency).toBe("sufficient");
    expect(a.inferredKeys).toContain("not_yet_returned");
    expect(evidenceDirective(a)).toMatch(/INFERRED/);
  });
});

describe("weak evidence degrades honestly instead of inventing specificity", () => {
  it("a bare category with no context is insufficient and warns", () => {
    const d = grounding([], "", "customer_question");
    expect(d.score).toBeLessThan(7);
    expect(d.finding).toBeTruthy();
    expect(d.finding).toMatch(/no concrete evidence/i);
  });

  it("the finding names an ACTION, not a generic nudge", () => {
    const d = grounding([], "", "customer_question");
    expect(d.finding).toMatch(/select a real record|write at least/i);
  });
});
