/**
 * tests/brain/query-plan.test.ts · 2026-09-08 (Brain plan, Wave 3)
 *
 * Each class has a positive and a negative example; the plan's fixture
 * sentences are here verbatim. No LLM, so every expectation is exact.
 */
import { describe, it, expect } from "vitest";
import { planQuery } from "@/lib/brain/query-plan";

const NOW = new Date("2026-09-08T12:00:00Z");
const plan = (m: string, recentTurns?: string[]) => planQuery(m, { now: NOW, recentTurns });

describe("planQuery — classes", () => {
  it("exact_identifier: quoted phrases, ticket tokens, PR numbers, code identifiers", () => {
    const p = plan('grep for "validityWhere"');
    expect(p.classes[0]).toBe("exact_identifier");
    expect(p.exactTerms).toContain("validityWhere");
    const q = plan("BDN-310 and #2196");
    expect(q.exactTerms).toEqual(expect.arrayContaining(["BDN-310", "#2196"]));
    expect(plan("tire prices").classes).not.toContain("exact_identifier");
  });

  it("temporal: 'what changed after August?' → correction + temporal with the boundary after August", () => {
    const p = plan("what changed after August?");
    expect(p.classes).toContain("temporal");
    expect(p.classes).toContain("correction");
    expect(p.asOf?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(plan("in July").asOf?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(plan("on 2026-08-15 I decided").asOf?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(plan("two weeks ago").asOf?.toISOString()).toBe("2026-08-25T12:00:00.000Z");
    expect(plan("how do I feel today").classes).not.toContain("temporal");
  });

  it("correction: 'which one is current?' and a changed amount", () => {
    expect(plan("which one is current?").classes[0]).toBe("correction");
    const p = plan("I no longer take 20mg, it's 10mg");
    expect(p.classes).toContain("correction");
    expect(plan("what is the capital of Ohio").classes).not.toContain("correction");
  });

  /**
   * 2026-09-17 · the correction class got its first consumer
   * (NICK_CORRECTION_THRESHOLD_BOOST lowers contradiction surfacing on a
   * correction turn), so its precision started to matter. The original regex
   * measured 41% recall at a 53% false-positive rate on these fixtures —
   * bare `updated?` / `corrected?` / `instead of` swallowed ordinary turns.
   * Both sets are pinned here: a future widening must beat the measurement,
   * not merely look reasonable. A false positive here is worse than a miss —
   * it loosens contradiction surfacing on a turn that asked nothing.
   */
  const CORRECTION_INTENDED = [
    "what changed since last week?",
    "which one is current?",
    "is that still true?",
    "did i change my mind on the reel cadence?",
    "my rent is no longer 1900",
    "what's my rate now vs in July",
    "has that changed?",
    "is that still accurate",
    "do i still use Acima for payment plans",
    "is my insurance info up to date",
    "what's changed with the shop hours",
    "which is current, the 1900 or the 2100 figure",
    "is that out of date now",
    "am i still paying 1900 for rent",
    "has the supplier list changed since August",
    "whats changed with the pricing",
    "is the 1900 figure superseded",
  ];

  const CORRECTION_ORDINARY = [
    "can you update my notes on the alignment rack",
    "update the shop hours to 8am",
    "i want an update on the Acima rollout",
    "use the new supplier instead of the old one",
    "book the oil change instead of the rotation",
    "i updated the sitemap yesterday",
    "send Moe an updated invoice",
    "the corrected total was 240",
    "what do you know about my insurance",
    "how much did the tires cost",
    "draft an updated pricing sheet",
    "correct the typo in the listing",
    "schedule an alignment instead",
    "give me the current weather",
    "what is my current balance",
    "update me on the reel pipeline",
    "change my appointment to Tuesday",
    "what changes should i make to the listing",
    "the current owner is Nick",
  ];

  it("correction · recall: every genuine premise check is classified", () => {
    const missed = CORRECTION_INTENDED.filter((m) => !plan(m).classes.includes("correction"));
    expect(missed).toEqual([]);
  });

  it("correction · precision: no ordinary turn is classified (an action request is not a premise check)", () => {
    const falsePositives = CORRECTION_ORDINARY.filter((m) => plan(m).classes.includes("correction"));
    expect(falsePositives).toEqual([]);
  });

  it("anaphoric_followup: a short pronoun question with a prior turn carries the referent", () => {
    const p = plan("what did I think about that before?", ["We discussed moving the shop's Instagram cadence to three reels a week."]);
    expect(p.classes).toContain("anaphoric_followup");
    expect(p.referent).toContain("three reels a week");
    expect(plan("what did I think about that before?").classes).not.toContain("anaphoric_followup"); // no prior turn
    expect(plan("tell me everything you know about the Instagram cadence plan and the reasons behind it", ["x"]).classes).not.toContain("anaphoric_followup"); // long
  });

  it("multi_hop: 'compare my rent in July and now' → two sub-queries, never the original", () => {
    const p = plan("compare my rent in July and now");
    expect(p.classes).toContain("multi_hop");
    expect(p.subQueries).toHaveLength(2);
    expect(p.subQueries).not.toContain(p.original);
    expect(p.classes).toContain("temporal");
    expect(plan("what is my rent").subQueries).toEqual([]);
  });

  it("multi_entity: two proper nouns joined", () => {
    expect(plan("Nour and Nick vs the shop").classes).toContain("multi_entity");
    expect(plan("what does Nick think").classes).not.toContain("multi_entity");
  });

  it("durable_personal: 'my' + a durable noun", () => {
    expect(plan("what is my wife's birthday").classes).toContain("durable_personal");
    expect(plan("what is the weather").classes).not.toContain("durable_personal");
  });

  it("broad_synthesis: a long rambling message, or an explicit summary ask; semantic_lookup is the fallback", () => {
    const long = "so I was thinking about the whole situation with the shop and the reels and the way the week went and whether any of it is actually moving the numbers or whether I am just busy and I want your read on all of it please";
    expect(plan(long).classes).toEqual(["broad_synthesis"]);
    expect(plan("summarize my week").classes).toEqual(["broad_synthesis"]);
    expect(plan("tire prices").classes).toEqual(["semantic_lookup"]);
  });
});

describe("planQuery — contract", () => {
  it("the original is always present and never rewritten; classes keep the primary order", () => {
    const p = plan('compare "BDN-310" in July and now');
    expect(p.original).toBe('compare "BDN-310" in July and now');
    expect(p.classes[0]).toBe("exact_identifier");
    expect(p.classes.indexOf("temporal")).toBeLessThan(p.classes.indexOf("multi_hop"));
  });
  it("is deterministic and never throws on empty or emoji-only input", () => {
    expect(plan("tire prices")).toEqual(plan("tire prices"));
    expect(plan("").classes).toEqual(["semantic_lookup"]);
    expect(plan("🚗🔥").classes).toEqual(["semantic_lookup"]);
    expect(planQuery(undefined as unknown as string).original).toBe("");
  });
});
