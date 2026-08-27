/**
 * Tests for buildLexicalTsQuery (lib/brain/contextual-recall.ts).
 *
 * Pure topic -> websearch_to_tsquery text builder for the Wave B lexical
 * lane. Topics are OR-joined so a memory matching ANY topic ranks; a
 * multi-word topic stays ANDed within itself by websearch_to_tsquery.
 */

import { describe, it, expect } from "vitest";
import { buildLexicalTsQuery, deriveFastTopics } from "@/lib/brain/contextual-recall";

describe("buildLexicalTsQuery", () => {
  it("OR-joins multiple topics", () => {
    expect(buildLexicalTsQuery(["revenue", "hiring"])).toBe("revenue or hiring");
  });

  it("trims whitespace and drops empty topics", () => {
    expect(buildLexicalTsQuery(["  tire inventory  ", "", "   "])).toBe("tire inventory");
  });

  it("preserves multi-word topics (websearch ANDs within, ORs across)", () => {
    expect(buildLexicalTsQuery(["tire inventory", "seo"])).toBe("tire inventory or seo");
  });

  it("returns an empty string when there are no usable topics", () => {
    expect(buildLexicalTsQuery([])).toBe("");
    expect(buildLexicalTsQuery(["", "  "])).toBe("");
  });
});

/**
 * deriveFastTopics (2026-08-27 retrieval baseline F2) — the deterministic
 * replacement for the p50-4.2s LLM topic extraction on the chat hot path.
 * Pure function; these canaries pin the behavior that makes the lexical
 * lane useful on real operator phrasing.
 */
describe("deriveFastTopics", () => {
  it("extracts informative terms from a real operator-shaped query", () => {
    const topics = deriveFastTopics(["what is going on with my sister visiting"]);
    expect(topics).toContain("sister");
    expect(topics).toContain("visiting");
    // Interrogative + filler words never become topics
    expect(topics).not.toContain("what");
    expect(topics).not.toContain("going");
    expect(topics).not.toContain("with");
  });

  it("newest message's terms win the cap (walks backwards)", () => {
    const older = "alpha bravo charlie delta echo foxtrot golf hotel";
    const newest = "medication adderall clomid paxil cialis magnesium wellbutrin zepbound";
    const topics = deriveFastTopics([older, newest]);
    expect(topics.length).toBe(8);
    expect(topics).toContain("zepbound");
    expect(topics).toContain("medication");
    expect(topics).not.toContain("alpha");
  });

  it("caps at 8 unique topics and dedupes", () => {
    const topics = deriveFastTopics(["tire tire tire shop shop revenue revenue"]);
    expect(topics.length).toBeLessThanOrEqual(8);
    expect(new Set(topics).size).toBe(topics.length);
  });

  it("returns [] for content-free input (pipeline falls back, same as LLM path)", () => {
    expect(deriveFastTopics([""])).toEqual([]);
    expect(deriveFastTopics(["ok"])).toEqual([]);
    expect(deriveFastTopics(["what about that?"])).toEqual([]);
  });

  it("feeds buildLexicalTsQuery cleanly (OR semantics end to end)", () => {
    const q = buildLexicalTsQuery(deriveFastTopics(["when is the egg retrieval"]));
    expect(q).toMatch(/egg/);
    expect(q).toMatch(/retrieval/);
    expect(q).toMatch(/ or /);
  });
});
