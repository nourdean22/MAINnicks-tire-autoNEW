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

  it("prioritizes exact-mentioned tools alongside CORE_TOOLS and ACTION_CORE under the cap", async () => {
    const allTools: Record<string, unknown> = {};
    for (let i = 1; i <= 60; i++) {
      allTools[`extraTool-${i}`] = { name: `extraTool-${i}` };
    }
    allTools["classifyThought"] = { name: "classifyThought" };
    allTools["createTask"] = { name: "createTask" };
    // This is an extra tool, NOT a core tool, but will be mentioned by exact name
    allTools["extraTool-45"] = { name: "extraTool-45" };

    // The query explicitly mentions 'extraTool-45'
    const pruned = await pruneTools("deep", allTools, "Can you run extraTool-45 please?", [0.1, 0.2]);
    const keys = Object.keys(pruned);

    expect(keys.length).toBe(50);
    expect(keys).toContain("classifyThought");
    expect(keys).toContain("createTask");
    expect(keys).toContain("extraTool-45");
  });
});

describe("pruneTools keyword attachment families (v10.0.532 followups)", () => {
  const tools = {
    getCameraIntelligence: { name: "getCameraIntelligence" },
    getReviewStats: { name: "getReviewStats" },
    getTopServices: { name: "getTopServices" },
    pricingAdvisorySummary: { name: "pricingAdvisorySummary" },
    analyzeWeightTrend: { name: "analyzeWeightTrend" },
    generateSQL: { name: "generateSQL" },
    runSimulation: { name: "runSimulation" },
  };

  it.each([
    ["getCameraIntelligence", "what's on the camera feed right now?", "getCameraIntelligence"],
    ["getCameraIntelligence", "show me the security camera footage", "getCameraIntelligence"],
    ["getReviewStats", "how are our google reviews doing, show me stats", "getReviewStats"],
    ["getTopServices", "what are our top services and popular jobs", "getTopServices"],
    ["pricingAdvisorySummary", "pricing advisory summary for this week", "pricingAdvisorySummary"],
    ["pricingAdvisorySummary", "what competitive pricing advice do we have?", "pricingAdvisorySummary"],
    ["analyzeWeightTrend", "plot my weight trend", "analyzeWeightTrend"],
    ["analyzeWeightTrend", "body weight progress", "analyzeWeightTrend"],
    ["generateSQL", "write a database query or generate sql for X", "generateSQL"],
    ["runSimulation", "run a simulation for this project", "runSimulation"],
  ])("matches query for %s: '%s'", async (toolName, query, expectedKey) => {
    const pruned = await pruneTools("standard", tools, query);
    expect(Object.keys(pruned)).toContain(expectedKey);
  });

  it("survives pruning in deep mode under pressure of 60 filler tools for all 7 followup tools", async () => {
    const allTools: Record<string, unknown> = {};
    for (let i = 1; i <= 60; i++) {
      allTools[`extraTool-${i}`] = { name: `extraTool-${i}` };
    }
    // Add Core and Action tools
    allTools["classifyThought"] = { name: "classifyThought" };
    allTools["createTask"] = { name: "createTask" };

    // Add the 7 followup tools
    const followups = [
      "getCameraIntelligence",
      "getReviewStats",
      "getTopServices",
      "pricingAdvisorySummary",
      "analyzeWeightTrend",
      "generateSQL",
      "runSimulation",
    ];
    for (const f of followups) {
      allTools[f] = { name: f };
    }

    // Trigger keyword matching by including the trigger words in the query
    const query = "show me the camera feed, google reviews stats, top services, pricing advisory, weight trend, generate sql and run simulation";
    const pruned = await pruneTools("deep", allTools, query, [0.1, 0.2]);
    const keys = Object.keys(pruned);

    expect(keys.length).toBe(50);
    expect(keys).toContain("classifyThought");
    expect(keys).toContain("createTask");
    for (const f of followups) {
      expect(keys).toContain(f);
    }
  });

  it("caps at 50 tools and prioritizes core, action, and direct-intent tools deterministically when priority candidates exceed 50", async () => {
    const allTools: Record<string, unknown> = {};
    // Construct 60 priority candidates (which match InstagramAutopost keyword regex)
    for (let i = 1; i <= 60; i++) {
      allTools[`InstagramAutopost-${i}`] = { name: `InstagramAutopost-${i}` };
    }

    // Add Core and Action tools
    allTools["classifyThought"] = { name: "classifyThought" };
    allTools["createTask"] = { name: "createTask" };

    // We will query with "instagram" to trigger keyword-based match
    const pruned = await pruneTools("deep", allTools, "please check my instagram posts", [0.1, 0.2]);
    const keys = Object.keys(pruned);

    // Assert cappings and deterministic ordering
    expect(keys.length).toBe(50);
    expect(keys[0]).toBe("classifyThought");
    expect(keys[1]).toBe("createTask");

    // The remaining slots (48) must be filled from the 60 tools deterministically.
    const extraKeys = keys.slice(2);
    expect(extraKeys).toEqual(Array.from(extraKeys).sort());
  });
});
