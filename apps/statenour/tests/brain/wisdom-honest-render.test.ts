/**
 * W1 · honest wisdom render (2026-10-29 wisdom-brain audit).
 *
 * Measured on prod the day this shipped (SELECT-only): the 21 live
 * Naval/Munger/Bezos pack rows carry source "manual", so the recall line
 * labelled Naval's words "you stated"; the line never named the author, so
 * the cite rule's tags could not be applied; the rule named five authors
 * with zero rows (Buffett, Jobs, Satori, Musk, Gates) and none of the three
 * that exist; and three boosts keyed on prefixes no row has.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  provenancePrefix,
  renderedContent,
  sourceTrustWeight,
  favoritePersonaBoost,
  isCuratedWisdomSource,
} from "@/lib/brain/contextual-recall";
import { resolveWisdomOrigin, wisdomOriginMeta } from "@/lib/brain/wisdom-origins";
import { INLINE_CITATIONS } from "@/lib/ai/prompt/policy/operator-rules";
import { personaBoost, sourceTrustWeight as pillTrustWeight } from "@/lib/brain/wisdom-suggest";

const mem = (over: Record<string, unknown>) => ({
  category: "wisdom",
  key: "wisdom_x",
  content: "x",
  confidence: 1,
  relevance: "background" as const,
  source: "manual",
  seenCount: 1,
  ...over,
});

describe("wisdom origin registry knows the packs that exist", () => {
  it.each([
    ["wisdom_naval-ravikant_024", "naval-ravikant", "Naval"],
    ["wisdom_charlie-munger_022", "charlie-munger", "Munger"],
    ["wisdom_bezos-letters_018", "bezos-letters", "Bezos"],
  ])("%s -> %s", (key, origin, badge) => {
    expect(resolveWisdomOrigin(key)).toBe(origin);
    expect(wisdomOriginMeta(origin).badge).toBe(badge);
  });
});

describe("provenancePrefix names the author of curated wisdom", () => {
  it("a pack row reads as the author's, never as 'you stated'", () => {
    const p = provenancePrefix(mem({ key: "wisdom_naval-ravikant_024", source: "manual" }));
    expect(p).toContain("Naval");
    expect(p).not.toContain("you stated");
  });

  it("a Greene law names the law", () => {
    const p = provenancePrefix(mem({ category: "greene_law", key: "law_28", source: "skill_ingestion" }));
    expect(p).toContain("Greene · Law 28");
    expect(p).not.toContain("you stated");
  });

  it("an uncurated wisdom row keeps its evidence label (no invented author)", () => {
    const p = provenancePrefix(mem({ key: "wisdom_cmabc123", source: "manual" }));
    expect(p).toContain("you stated");
    expect(p).not.toMatch(/Naval|Munger|Bezos|Greene/);
  });
});

describe("renderedContent keeps a whole principle", () => {
  const long = "a".repeat(400);
  it("wisdom background rows render 300 chars", () => {
    expect(renderedContent(mem({ content: long }))).toHaveLength(300);
  });
  it("other background rows stay at 150", () => {
    expect(renderedContent(mem({ category: "insight", content: long }))).toHaveLength(150);
  });
});

describe("curated pack sources rank and age like curated sources", () => {
  it("pack:* weighs the same as skill_ingestion in recall and in the pill", () => {
    expect(sourceTrustWeight("pack:naval-ravikant")).toBe(sourceTrustWeight("skill_ingestion"));
    expect(pillTrustWeight("pack:charlie-munger")).toBe(pillTrustWeight("skill_ingestion"));
  });
  it("pack:* is exempt from the cold-wisdom decay", () => {
    expect(isCuratedWisdomSource("pack:bezos-letters")).toBe(true);
    expect(isCuratedWisdomSource("wisdom-distiller")).toBe(false);
  });
});

describe("persona boosts match keys that exist", () => {
  it("Greene's favorite-persona boost fires on greene_law rows", () => {
    expect(favoritePersonaBoost("law_28", "greene_law")).toBeGreaterThan(1);
    expect(favoritePersonaBoost("law_28", "insight")).toBe(1);
  });
  it("the pill boosts the real Naval/Munger/Bezos keys", () => {
    expect(personaBoost("wisdom_naval-ravikant_024")).toBeGreaterThan(1);
    expect(personaBoost("wisdom_charlie-munger_022")).toBeGreaterThan(1);
    expect(personaBoost("wisdom_bezos-letters_018")).toBeGreaterThan(1);
  });
});

describe("INLINE_CITATIONS cites only authors shown this turn", () => {
  it("names no author the brain has no rows for", () => {
    for (const absent of ["Buffett", "Jobs", "Satori", "Musk", "Gates"]) {
      expect(INLINE_CITATIONS).not.toContain(absent);
    }
  });
  it("restricts tags to authors named in this turn's recalled lines", () => {
    expect(INLINE_CITATIONS).toMatch(/ONLY an author named in a wisdom line recalled this turn/);
    expect(INLINE_CITATIONS).toMatch(/none named, no tag/);
  });
  it("keeps the principle-shapes-the-answer and paraphrase rules", () => {
    expect(INLINE_CITATIONS).toContain("ONLY when the wisdom's principle is shaping your answer");
    expect(INLINE_CITATIONS.toLowerCase()).toContain("never cite verbatim");
  });
});
