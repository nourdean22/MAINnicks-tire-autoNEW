import { describe, expect, it } from "vitest";
import { buildBroadSearchFtsQuery, normalizeMemoryKeyQuery } from "@/lib/brain/search-query";

describe("brain search query normalization", () => {
  it("maps natural language to the underscore key convention", () => {
    expect(normalizeMemoryKeyQuery("  Mind your business! ")).toBe("mind_your_business");
  });

  it("keeps meaningful terms broad when conversational filler is present", () => {
    expect(buildBroadSearchFtsQuery("what do I tell myself when I am anxious")).toBe(
      "myself or anxious",
    );
  });

  it("deduplicates terms and preserves a single meaningful term", () => {
    expect(buildBroadSearchFtsQuery("anxiety anxiety")).toBe("anxiety");
    expect(buildBroadSearchFtsQuery("business")).toBe("business");
  });

  it("falls back to the original query when it has no searchable terms", () => {
    expect(buildBroadSearchFtsQuery("is it?")).toBe("is it?");
  });
});
