/**
 * PROVENANCE IS NOT AUTHORITY -- 2026-09-10.
 *
 * `AUTHORITATIVE_TIERS` was documented as the tiers permitted to "inform
 * a state-changing tool call or be stated as fact", and it contained
 * AGENT_INFERRED. Those are two different questions:
 *
 *   "Nour probably wants this customer emailed today"   (inference)
 *   "Nour told me to email this customer today"          (authority)
 *
 * Collapsing them is how an assistant becomes confidently wrong about
 * its owner's own intentions -- and how "MODEL_INFERRED: prefers B"
 * quietly hardens into "USER FACT: chose B", which he is then held to.
 *
 * Two orthogonal questions, two predicates:
 *   canRenderAsKnowledge  -> is this ATTACKER-CONTROLLED? (fencing)
 *   canAuthorizeSideEffect-> may this be the BASIS for a side effect?
 */
import { describe, it, expect } from "vitest";
import {
  canRenderAsKnowledge,
  canAuthorizeSideEffect,
  shouldStampInferredBasis,
  ACTION_AUTHORIZING_TIERS,
  AUTHORITATIVE_TIERS,
} from "@/lib/brain/memory-trust";
import { evaluateToolAction } from "@/lib/tools/tool-policy";

describe("the two predicates answer different questions", () => {
  it("an inference RENDERS as knowledge -- it is not attacker-controlled", () => {
    expect(canRenderAsKnowledge("AGENT_INFERRED")).toBe(true);
  });

  it("but an inference may NOT be the basis for a side effect", () => {
    expect(canAuthorizeSideEffect("AGENT_INFERRED")).toBe(false);
  });

  it("external content fails both -- it is hostile text, not knowledge", () => {
    expect(canRenderAsKnowledge("EXTERNAL_CONTENT")).toBe(false);
    expect(canAuthorizeSideEffect("EXTERNAL_CONTENT")).toBe(false);
  });

  // CONTROL: without these, a predicate returning false for everything
  // would satisfy every assertion above while disabling the product.
  it("CONTROL - what the operator stated does both", () => {
    expect(canRenderAsKnowledge("OPERATOR")).toBe(true);
    expect(canAuthorizeSideEffect("OPERATOR")).toBe(true);
  });

  it("CONTROL - first-party derived data does both", () => {
    expect(canRenderAsKnowledge("SYSTEM_DERIVED")).toBe(true);
    expect(canAuthorizeSideEffect("SYSTEM_DERIVED")).toBe(true);
  });

  it("the authority set is strictly narrower than the rendering set", () => {
    // The regression this file exists to prevent: someone "simplifying"
    // the two lists back into one.
    expect(ACTION_AUTHORIZING_TIERS.length).toBeLessThan(AUTHORITATIVE_TIERS.length);
    for (const t of ACTION_AUTHORIZING_TIERS) expect(AUTHORITATIVE_TIERS).toContain(t);
    expect(ACTION_AUTHORIZING_TIERS).not.toContain("AGENT_INFERRED");
  });
});

describe("an inference cannot promote itself into durable memory", () => {
  const base = { toolId: "memory.pin", actionType: "execute", memoryWriteRequested: true };

  it("a memory write based only on a model inference needs human review", () => {
    const d = evaluateToolAction({ ...base, basedOnInferredMemory: true });
    expect(d.decision).toBe("require_memory_review");
    expect(d.reason).toMatch(/inference/i);
  });

  it("so does a memory write carrying external content -- the sibling rule", () => {
    const d = evaluateToolAction({ ...base, containsExternalContent: true });
    expect(d.decision).toBe("require_memory_review");
  });

  // CONTROL: an ordinary operator-stated memory write must NOT be
  // escalated, or every remembered preference becomes an approval prompt
  // and the operator learns to click through them without reading.
  it("CONTROL - an operator-stated memory write is not escalated for this reason", () => {
    const d = evaluateToolAction(base);
    expect(d.decision).not.toBe("require_memory_review");
  });
});

describe("the turn stamp -- when is a turn running on inference alone", () => {
  const h = (trustTier: string) => ({ trustTier });

  it("stamps a turn whose entire recall set is model inference", () => {
    expect(shouldStampInferredBasis([h("AGENT_INFERRED"), h("AGENT_INFERRED")])).toBe(true);
  });

  it("stamps a turn running only on external content", () => {
    expect(shouldStampInferredBasis([h("EXTERNAL_CONTENT")])).toBe(true);
  });

  // CONTROL: ONE authorizing row is enough. The stamp asks "is there any
  // real basis here", not "is everything perfect" -- otherwise a single
  // inferred row alongside the operator's own words would escalate the
  // whole turn.
  it("CONTROL - one operator-stated row is enough to clear the stamp", () => {
    expect(shouldStampInferredBasis([h("AGENT_INFERRED"), h("OPERATOR")])).toBe(false);
  });

  it("CONTROL - system-derived data also clears it", () => {
    expect(shouldStampInferredBasis([h("EXTERNAL_CONTENT"), h("SYSTEM_DERIVED")])).toBe(false);
  });

  /**
   * The distinction that keeps this usable: NO hits is not the same as
   * INFERRED hits. Stamping the empty case would escalate every
   * cold-start turn, and an approval prompt the operator sees on every
   * turn is one they learn to click through without reading -- which is
   * a worse security outcome than the bug.
   */
  it("CONTROL - an empty recall set is NOT stamped", () => {
    expect(shouldStampInferredBasis([])).toBe(false);
  });

  it("a row with no tier at all does not count as authorizing", () => {
    expect(shouldStampInferredBasis([{ trustTier: undefined }])).toBe(true);
    expect(shouldStampInferredBasis([{ trustTier: null }])).toBe(true);
  });
});
