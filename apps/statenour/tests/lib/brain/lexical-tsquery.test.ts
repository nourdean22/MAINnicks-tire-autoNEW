/**
 * Tests for buildLexicalTsQuery (lib/brain/contextual-recall.ts).
 *
 * Pure topic -> websearch_to_tsquery text builder for the Wave B lexical
 * lane. Topics are OR-joined so a memory matching ANY topic ranks; a
 * multi-word topic stays ANDed within itself by websearch_to_tsquery.
 */

import { describe, it, expect } from "vitest";
import { buildLexicalTsQuery } from "@/lib/brain/contextual-recall";

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
