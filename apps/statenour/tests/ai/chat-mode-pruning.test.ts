import { describe, it, expect, vi } from "vitest";

// Mock imports inside pruneTools to make it testable without dependencies
vi.mock("@/lib/ai/tool-telemetry", () => ({
  isToolBlocked: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/ai/tool-embeddings", () => ({
  rankToolsBySimilarity: vi.fn().mockImplementation(() => {
    const results = [];
    for (let i = 1; i <= 60; i++) {
      results.push([`extraTool-${i}`, 0.9]);
    }
    return results;
  }),
  isToolEmbeddingCacheWarm: vi.fn().mockReturnValue(true),
}));

import { pruneTools } from "@/lib/ai/chat-mode";

describe("pruneTools priority-preserving cap", () => {
  it("keeps CORE_TOOLS and ACTION_CORE first in deep mode and caps at 50", async () => {
    // Construct a mock toolset of 60 tools
    const allTools: Record<string, unknown> = {};
    for (let i = 1; i <= 60; i++) {
      allTools[`extraTool-${i}`] = { name: `extraTool-${i}` };
    }
    // Add CORE and ACTION tools
    allTools["classifyThought"] = { name: "classifyThought" };
    allTools["createTask"] = { name: "createTask" };

    // Pass userEmbedding to trigger the similarity ranking mock
    const pruned = await pruneTools("deep", allTools, "test query", [0.1, 0.2]);
    const keys = Object.keys(pruned);

    expect(keys.length).toBe(50);
    expect(keys).toContain("classifyThought");
    expect(keys).toContain("createTask");
  });
});
