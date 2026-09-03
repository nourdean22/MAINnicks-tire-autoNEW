/**
 * tests/ai/search-tools-semantic-fallback.test.ts
 *
 * searchTools is the recovery lane: the pruner attaches ~24 of 181 tools
 * per turn (lib/ai/chat-mode.ts:545) and this is how the model reaches
 * the rest. It scored purely by TOKEN OVERLAP and dropped every zero, so
 * a query sharing no words with the catalog returned nothing -- the same
 * semantic gap that made the pruner miss in the first place defeated its
 * own fallback, and the model correctly concluded the capability did not
 * exist. That is the "chat tools never work" report.
 *
 * CANARY DISCIPLINE (root AGENTS.md): a test that only proves "semantic
 * results come back" would still pass if the fallback ran on EVERY call
 * -- which would put a provider round-trip on the hot path of a lane
 * whose whole job is to be cheap. So the keyword case asserts the
 * embedding path is NOT touched, and the failure cases assert the lane
 * degrades to empty rather than throwing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const isToolEmbeddingCacheWarm = vi.fn(() => true);
const embedUserMessage = vi.fn(async () => [0.1, 0.2, 0.3]);
const rankToolsBySimilarity = vi.fn(() => [["arsenalWebSearch", 0.42]] as Array<[string, number]>);

vi.mock("@/lib/ai/tool-embeddings", () => ({
  isToolEmbeddingCacheWarm,
  embedUserMessage,
  rankToolsBySimilarity,
}));

import { metaTools } from "@/lib/ai/tools/meta";

type SearchResult = {
  count: number;
  matchedBy: "keyword" | "semantic" | "hybrid";
  tools: Array<{ name: string }>;
};

async function search(query: string, limit = 5): Promise<SearchResult> {
  return (await metaTools.searchTools.execute!(
    { query, limit } as never,
    {} as never,
  )) as SearchResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  isToolEmbeddingCacheWarm.mockReturnValue(true);
  embedUserMessage.mockResolvedValue([0.1, 0.2, 0.3]);
  rankToolsBySimilarity.mockReturnValue([["arsenalWebSearch", 0.42]]);
});

describe("searchTools keyword path", () => {
  it("answers lexically and does NOT pay for an embedding", async () => {
    // "memory" overlaps real catalog tool names, so the cheap path wins.
    const res = await search("memory");

    expect(res.count).toBeGreaterThan(0);
    expect(res.matchedBy).toBe("keyword");
    // The canary: if this ever fires on a keyword hit, every recovery
    // starts costing a provider round-trip.
    expect(embedUserMessage).not.toHaveBeenCalled();
    expect(rankToolsBySimilarity).not.toHaveBeenCalled();
  });
});

describe("searchTools semantic fallback", () => {
  it("recovers a tool that shares no token with the query", async () => {
    // Nonsense tokens: passes the >1-char token filter, overlaps nothing
    // in any tool name, category or description -- so pre-fix this
    // returned count 0 and the model declared the capability missing.
    const res = await search("zzzqqq wwwvvv");

    expect(embedUserMessage).toHaveBeenCalledOnce();
    expect(res.matchedBy).toBe("semantic");
    expect(res.tools.map((t) => t.name)).toContain("arsenalWebSearch");
  });

  it("uses the pruner's 0.25 floor, not the 0.3 library default", async () => {
    await search("zzzqqq wwwvvv", 5);
    // Stricter than the selector it backstops would make the recovery
    // lane reject tools the pruner would have surfaced.
    expect(rankToolsBySimilarity).toHaveBeenCalledWith(
      expect.any(Array),
      5,
      0.25,
    );
  });

  it("degrades to empty (never throws) on a cold cache", async () => {
    isToolEmbeddingCacheWarm.mockReturnValue(false);
    const res = await search("zzzqqq wwwvvv");

    expect(embedUserMessage).not.toHaveBeenCalled();
    expect(res.count).toBe(0);
    expect(res.matchedBy).toBe("keyword");
  });

  it("degrades to empty (never throws) when embedding fails", async () => {
    embedUserMessage.mockRejectedValue(new Error("provider down"));
    const res = await search("zzzqqq wwwvvv");

    expect(res.count).toBe(0);
  });

  it("degrades to empty when the embedding call returns nothing", async () => {
    embedUserMessage.mockResolvedValue([]);
    const res = await search("zzzqqq wwwvvv");

    expect(rankToolsBySimilarity).not.toHaveBeenCalled();
    expect(res.count).toBe(0);
  });
});

// 2026-09-02 review P1 · The first version of this fallback fired only on
// `scored.length === 0`. But the lexical scorer substring-matches every
// token, and the filter kept 2-char tokens -- so "on" out of "best
// thriller shows on streaming" matched inside dozens of unrelated names
// and descriptions (~145 hits), `scored` was never empty, and the
// fallback was UNREACHABLE for the exact query class it was written for.
// Stop-words + a 3-char floor + a weak-evidence trigger fix that. This
// test is the operator's real query.
describe("searchTools . the query from the screenshot", () => {
  it("consults semantic ranking instead of drowning in stop-word hits", async () => {
    const res = await search("best thriller shows on streaming");

    // Whatever the lexical pass turned up, it was not a NAME match, so
    // semantic must have been consulted.
    expect(embedUserMessage).toHaveBeenCalledOnce();
    expect(res.matchedBy === "semantic" || res.matchedBy === "hybrid").toBe(true);
    expect(res.tools.map((t) => t.name)).toContain("arsenalWebSearch");
  });

  it("keeps a weak lexical hit rather than trading one miss for another", async () => {
    const res = await search("best thriller shows on streaming", 5);
    // Merge, not replace: semantic first, lexical retained behind it.
    expect(res.tools.length).toBeGreaterThan(0);
    expect(res.tools.length).toBeLessThanOrEqual(5);
    expect(new Set(res.tools.map((t) => t.name)).size).toBe(res.tools.length);
  });
});
