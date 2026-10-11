/**
 * 05-X7: the contextual recall block must say "inferred" for LLM-derived rows.
 *
 * evidenceClassForSource("conversation_analysis") falls through to the
 * ladder's fallback, so a model-made insight rendered as "unclassified", the
 * same label as an unknown cron. The trust classifier already knows such a
 * source is AGENT_INFERRED; the prefix now says so. evidenceClassForSource is
 * left alone (the commit gateway ranks on it).
 */
import { describe, expect, it } from "vitest";
import { provenancePrefix } from "@/lib/brain/contextual-recall";
import { evidenceClassForSource } from "@/lib/brain/memory-commit-gateway";

const mem = (category: string, source: string) => ({
  category,
  content: "x",
  confidence: 0.5,
  relevance: "direct" as const,
  source,
});

describe("provenancePrefix / LLM-derived rows", () => {
  it("an insight from conversation_analysis is labelled inferred", () => {
    expect(provenancePrefix(mem("insight", "conversation_analysis"))).toContain("inferred");
  });

  it("a nick-authored row is labelled inferred, not unclassified", () => {
    expect(provenancePrefix(mem("nick_advice", "nick_reflection"))).toContain("inferred");
    expect(provenancePrefix(mem("nick_advice", "nick_reflection"))).not.toContain("unclassified");
  });

  it("CONTROL: an operator source still reads 'you stated'", () => {
    expect(provenancePrefix(mem("insight", "manual"))).toContain("you stated");
  });

  it("the gateway ladder itself is unchanged", () => {
    expect(evidenceClassForSource("conversation_analysis")).toBe("weak_inference");
  });
});
