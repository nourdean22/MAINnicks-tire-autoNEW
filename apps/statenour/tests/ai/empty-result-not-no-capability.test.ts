/**
 * An empty tool result must not become a denial of the tool.
 *
 * On 2026-08-29 Nick told the operator, in an app built on memory:
 *
 *   "I don't have reliable information about whether a pinned memory named
 *    mantra_mind_your_business exists ... none of that is something I can
 *    verify in this conversation."
 *
 * The row existed in production (category `pinned_user`, confidence 0.4,
 * not deleted, not superseded). Recall had missed it, and the model
 * generalised the miss into "I have no memory access".
 *
 * That was a PROMPT GAP, not a wrong rule. The whole fabrication-defense
 * stack pushes one way -- TRUTH_RULE_NEVER_FABRICATE, ANALYTIC_CONFIDENCE
 * ("Never invent"), known-truth-guard, and static.ts's "If you can't
 * actually do something, say so" -- and nothing told the model how to
 * narrate a search that ran and came back empty.
 *
 * This pins REACHABILITY, not registration. The rule being exported, or
 * present in the bundle array, proves nothing: the failure mode this repo
 * keeps hitting is a writer with no reader. So the load-bearing assertion
 * walks the real production path
 * (buildStaticPrefix -> getOperatorPolicyBlock -> the rule) and asserts the
 * text arrives in the rendered prompt.
 */
import { describe, it, expect } from "vitest";
import {
  EMPTY_RESULT_IS_NOT_NO_CAPABILITY,
  getOperatorPolicyBlock,
  getOperatorPolicyLines,
} from "@/lib/ai/prompt/policy/operator-rules";
import { buildStaticPrefix } from "@/lib/ai/prompt/static";

describe("EMPTY RESULT rule · reaches the rendered system prompt", () => {
  it("is present in the prompt buildStaticPrefix actually renders", () => {
    // The real consumer chain, not the const in isolation.
    const prompt = buildStaticPrefix();
    expect(prompt).toContain("## EMPTY RESULT");
    expect(prompt).toContain("RAN and FOUND NOTHING");
  });

  it("ships alongside the truth rule, so both directions are bounded", () => {
    const block = getOperatorPolicyBlock();
    expect(block).toContain("TRUTH RULE");
    expect(block).toContain("EMPTY RESULT");
    // Order matters for readability but not correctness; presence of both
    // in one injected block is the invariant.
    expect(getOperatorPolicyLines()).toContain(EMPTY_RESULT_IS_NOT_NO_CAPABILITY);
  });
});

describe("EMPTY RESULT rule · says the specific thing that went wrong", () => {
  it("names the two states the model collapsed, and separates them", () => {
    expect(EMPTY_RESULT_IS_NOT_NO_CAPABILITY).toContain("EMPTY");
    expect(EMPTY_RESULT_IS_NOT_NO_CAPABILITY).toContain("UNAVAILABLE");
    expect(EMPTY_RESULT_IS_NOT_NO_CAPABILITY).toMatch(/never collapse the first into the second/i);
  });

  it("quotes the actual production denial as a counter-example", () => {
    // Verbatim from the operator's transcript. If someone softens the rule
    // later, the sentence that caused the incident should still be banned
    // by name rather than by paraphrase.
    expect(EMPTY_RESULT_IS_NOT_NO_CAPABILITY).toContain(
      "None of that is something I can verify in this conversation.",
    );
    expect(EMPTY_RESULT_IS_NOT_NO_CAPABILITY).toContain(
      `I don't have reliable information about whether that memory exists.`,
    );
  });

  it("names the recall tools by their real registered names", async () => {
    // A rule that advertises a tool the model cannot call is fabrication
    // bait -- static.ts already carries a comment about exactly that
    // mistake (four dead tool names shipped in the prompt until 2026-06-10).
    const { TOOL_CATALOG } = await import("@/lib/ai/tools/catalog");
    const names = new Set(TOOL_CATALOG.map((t: { name: string }) => t.name));
    for (const advertised of [
      "searchMemories",
      "searchColdMemory",
      "searchReflections",
      "searchConversations",
    ]) {
      expect(EMPTY_RESULT_IS_NOT_NO_CAPABILITY).toContain(advertised);
      expect(names.has(advertised)).toBe(true);
    }
  });
});
