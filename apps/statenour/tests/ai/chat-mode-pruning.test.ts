import { describe, it, expect, vi } from "vitest";

const recordToolSelection = vi.fn().mockResolvedValue(undefined);

// Mock imports inside pruneTools to make it testable without dependencies
vi.mock("@/lib/ai/tool-telemetry", () => ({
  isToolBlocked: vi.fn().mockReturnValue(false),
}));

// Spread the REAL module and override only what this file steers. The
// hand-written version omitted `scoreToolsBySimilarity` once pruneTools began
// calling it for tier-4 ordering, so every call landed as `undefined`, threw,
// and was swallowed by the caller's fallback — the file kept passing while
// exercising an error path it never meant to test.
vi.mock("@/lib/ai/tool-embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/tool-embeddings")>();
  return {
    ...actual,
    rankToolsBySimilarity: vi.fn().mockImplementation(() => {
      const results = [];
      for (let i = 1; i <= 60; i++) {
        results.push([`extraTool-${i}`, 0.9]);
      }
      return results;
    }),
    isToolEmbeddingCacheWarm: vi.fn().mockReturnValue(true),
    // No cached embeddings in this suite, so tier-4 ranking has nothing to say
    // and falls back to alphabetical — which is what these budget-capping
    // assertions were written against.
    scoreToolsBySimilarity: vi.fn(() => new Map<string, number>()),
  };
});

vi.mock("@/lib/ai/tool-selection-telemetry", () => ({ recordToolSelection }));

import { pruneTools } from "@/lib/ai/chat-mode";
import { afterEach } from "vitest";

// 2026-08-12 · the ceiling is now the env-tunable NICK_TOOL_BUDGET
// (default 24, floor 10 — was a hardcoded 50). Tool-selection precision
// degrades sharply with exposed-tool count; the tiers keep priority
// order and prepare-tools re-adds intent-critical tools after pruning.
const DEFAULT_BUDGET = 24;

afterEach(() => {
  delete process.env.NICK_TOOL_BUDGET;
  recordToolSelection.mockClear();
});

describe("pruneTools semantic-tier telemetry", () => {
  it("records a skipped semantic tier distinctly from a cold embedding cache", async () => {
    await pruneTools(
      "standard",
      { searchMemories: { name: "searchMemories" } },
      "hello",
      [],
      { turnId: "trace-skipped" },
    );

    await vi.waitFor(() => expect(recordToolSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: "trace-skipped",
        semanticTierAttempted: false,
        embeddingCacheWarm: false,
      }),
    ));
  });

  it("records a cold cache only when the eligible semantic tier was attempted", async () => {
    const { isToolEmbeddingCacheWarm } = await import("@/lib/ai/tool-embeddings");
    vi.mocked(isToolEmbeddingCacheWarm).mockReturnValueOnce(false);

    await pruneTools(
      "standard",
      { searchMemories: { name: "searchMemories" } },
      "hello",
      [0.1, 0.2],
      { turnId: "trace-cold" },
    );

    await vi.waitFor(() => expect(recordToolSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: "trace-cold",
        semanticTierAttempted: true,
        embeddingCacheWarm: false,
      }),
    ));
  });
});

describe("pruneTools priority-preserving cap", () => {
  it("keeps CORE_TOOLS and ACTION_CORE first in deep mode and caps at the default budget", async () => {
    // Construct a mock toolset of 60 tools
    const allTools: Record<string, unknown> = {};
    for (let i = 1; i <= 60; i++) {
      allTools[`extraTool-${i}`] = { name: `extraTool-${i}` };
    }
    // Add CORE and ACTION tools
    allTools["searchMemories"] = { name: "searchMemories" };
    allTools["createTask"] = { name: "createTask" };

    // Pass userEmbedding to trigger the similarity ranking mock
    const pruned = await pruneTools("deep", allTools, "test query", [0.1, 0.2]);
    const keys = Object.keys(pruned);

    expect(keys.length).toBe(DEFAULT_BUDGET);
    expect(keys).toContain("searchMemories");
    expect(keys).toContain("createTask");
  });

  it("prioritizes exact-mentioned tools alongside CORE_TOOLS and ACTION_CORE under the cap", async () => {
    const allTools: Record<string, unknown> = {};
    for (let i = 1; i <= 60; i++) {
      allTools[`extraTool-${i}`] = { name: `extraTool-${i}` };
    }
    allTools["searchMemories"] = { name: "searchMemories" };
    allTools["createTask"] = { name: "createTask" };
    // This is an extra tool, NOT a core tool, but will be mentioned by exact name
    allTools["extraTool-45"] = { name: "extraTool-45" };

    // The query explicitly mentions 'extraTool-45'
    const pruned = await pruneTools("deep", allTools, "Can you run extraTool-45 please?", [0.1, 0.2]);
    const keys = Object.keys(pruned);

    expect(keys.length).toBe(DEFAULT_BUDGET);
    expect(keys).toContain("searchMemories");
    expect(keys).toContain("createTask");
    expect(keys).toContain("extraTool-45");
  });

  it("honors NICK_TOOL_BUDGET and enforces the floor of 10", async () => {
    const allTools: Record<string, unknown> = {};
    for (let i = 1; i <= 60; i++) {
      allTools[`extraTool-${i}`] = { name: `extraTool-${i}` };
    }
    allTools["searchMemories"] = { name: "searchMemories" };
    allTools["createTask"] = { name: "createTask" };

    process.env.NICK_TOOL_BUDGET = "12";
    let keys = Object.keys(await pruneTools("deep", allTools, "test query", [0.1, 0.2]));
    expect(keys.length).toBe(12);
    expect(keys).toContain("searchMemories");
    expect(keys).toContain("createTask");

    // Below the floor, the floor wins (CORE + ACTION_CORE must stay coherent).
    process.env.NICK_TOOL_BUDGET = "3";
    keys = Object.keys(await pruneTools("deep", allTools, "test query", [0.1, 0.2]));
    expect(keys.length).toBe(10);
  });
});

describe("pruneTools keyword attachment families (v10.0.532 followups)", () => {
  const tools = {
    getCameraIntelligence: { name: "getCameraIntelligence" },
    getReviewStats: { name: "getReviewStats" },
    pricingAdvisorySummary: { name: "pricingAdvisorySummary" },
    analyzeWeightTrend: { name: "analyzeWeightTrend" },
    generateSQL: { name: "generateSQL" },
    runSimulation: { name: "runSimulation" },
  };

  it.each([
    ["getCameraIntelligence", "what's on the camera feed right now?", "getCameraIntelligence"],
    ["getCameraIntelligence", "show me the security camera footage", "getCameraIntelligence"],
    ["getReviewStats", "how are our google reviews doing, show me stats", "getReviewStats"],
    // getTopServices: retired 2026-10-08 with its keyword family (lib/ai/chat-mode.ts).
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

  it("survives pruning in deep mode under pressure of 60 filler tools for all 6 followup tools", async () => {
    const allTools: Record<string, unknown> = {};
    for (let i = 1; i <= 60; i++) {
      allTools[`extraTool-${i}`] = { name: `extraTool-${i}` };
    }
    // Add Core and Action tools
    allTools["searchMemories"] = { name: "searchMemories" };
    allTools["createTask"] = { name: "createTask" };

    // Add the 6 followup tools
    const followups = [
      "getCameraIntelligence",
      "getReviewStats",
      "pricingAdvisorySummary",
      "analyzeWeightTrend",
      "generateSQL",
      "runSimulation",
    ];
    for (const f of followups) {
      allTools[f] = { name: f };
    }

    // Trigger keyword matching by including the trigger words in the query
    const query = "show me the camera feed, google reviews stats, pricing advisory, weight trend, generate sql and run simulation";
    const pruned = await pruneTools("deep", allTools, query, [0.1, 0.2]);
    const keys = Object.keys(pruned);

    // The v10.0.532 guarantee survives the tighter default budget: the
    // keyword tier outranks the semantic filler, so every followup tool
    // stays present at 24 exactly as it did at 50.
    expect(keys.length).toBe(DEFAULT_BUDGET);
    expect(keys).toContain("searchMemories");
    expect(keys).toContain("createTask");
    for (const f of followups) {
      expect(keys).toContain(f);
    }
  });

  it("caps at the budget and prioritizes core, action, and direct-intent tools deterministically when priority candidates exceed it", async () => {
    const allTools: Record<string, unknown> = {};
    // Construct 60 priority candidates (which match InstagramAutopost keyword regex)
    for (let i = 1; i <= 60; i++) {
      allTools[`InstagramAutopost-${i}`] = { name: `InstagramAutopost-${i}` };
    }

    // Add Core and Action tools
    allTools["searchMemories"] = { name: "searchMemories" };
    allTools["createTask"] = { name: "createTask" };

    // We will query with "instagram" to trigger keyword-based match
    const pruned = await pruneTools("deep", allTools, "please check my instagram posts", [0.1, 0.2]);
    const keys = Object.keys(pruned);

    // Assert cappings and deterministic ordering
    expect(keys.length).toBe(DEFAULT_BUDGET);
    expect(keys[0]).toBe("searchMemories");
    expect(keys[1]).toBe("createTask");

    // The remaining slots must be filled from the 60 tools deterministically.
    const extraKeys = keys.slice(2);
    expect(extraKeys).toEqual(Array.from(extraKeys).sort());
  });

  it("proves that default extras are returned when only core tools match for an unmatched normal-language request", async () => {
    const allTools: Record<string, unknown> = {
      searchMemories: { name: "searchMemories" },
      createTask: { name: "createTask" },
      getCommitments: { name: "getCommitments" },
      getTasks: { name: "getTasks" },
      dailyPulse: { name: "dailyPulse" },
      findCustomer: { name: "findCustomer" },
      unrelatedTool: { name: "unrelatedTool" },
    };

    // A simple query with no keyword/exact/semantic match
    const pruned = await pruneTools("standard", allTools, "hello how are you");
    const keys = Object.keys(pruned);

    expect(keys).toContain("searchMemories");
    expect(keys).toContain("createTask");
    // Verify default extras are included
    expect(keys).toContain("getCommitments");
    expect(keys).toContain("getTasks");
    expect(keys).toContain("dailyPulse");
    expect(keys).toContain("findCustomer");
    // Verify unrelated tool is NOT included
    expect(keys).not.toContain("unrelatedTool");
  });
});

describe("2026-08-25 CORE demotion — corrected-number prune, behavior pinned", () => {
  // The three tools were offered on ~every turn since the telemetry
  // epoch (2026-05-12) and chosen 0 / 0 / 1 times lifetime — the
  // inverse of the census's pruner-confound. They leave the always-on
  // set but MUST stay reachable through deterministic intent paths.
  function toolset(): Record<string, unknown> {
    const allTools: Record<string, unknown> = {};
    for (let i = 1; i <= 60; i++) allTools[`extraTool-${i}`] = { name: `extraTool-${i}` };
    for (const name of [
      "classifyThought", "searchMemories", "createTask",
      "setTaskPriority", "syncKnowledge", "runDeviceCommand",
    ]) allTools[name] = { name };
    return allTools;
  }

  it("a neutral turn no longer carries the three demoted tools — but still carries real CORE (positive control)", async () => {
    const keys = Object.keys(await pruneTools("standard", toolset(), "how are things looking", [0.1, 0.2]));
    expect(keys).not.toContain("setTaskPriority");
    expect(keys).not.toContain("syncKnowledge");
    expect(keys).not.toContain("runDeviceCommand");
    // Positive control: the demotion must not have gutted CORE itself.
    // 2026-09-19 · classifyThought was the other half of this control and has
    // since been demoted in its own right (see the block below), so the
    // control now rests on searchMemories, which is still CORE and is now
    // first in the list.
    expect(keys).toContain("searchMemories");
    expect(keys).toContain("createTask");
  });

  it("device phrasing deterministically re-surfaces runDeviceCommand", async () => {
    const keys = Object.keys(await pruneTools("standard", toolset(), "lock the front door please", [0.1, 0.2]));
    expect(keys).toContain("runDeviceCommand");
  });

  it("knowledge-sync phrasing deterministically re-surfaces syncKnowledge", async () => {
    const keys = Object.keys(await pruneTools("standard", toolset(), "sync my knowledge before the review", [0.1, 0.2]));
    expect(keys).toContain("syncKnowledge");
  });

  it("priority phrasing re-surfaces setTaskPriority via the task family", async () => {
    const keys = Object.keys(await pruneTools("standard", toolset(), "bump that task to top priority", [0.1, 0.2]));
    expect(keys).toContain("setTaskPriority");
  });
});

/**
 * 2026-09-19 · SECOND CORE demotion — four tools, each with its path proven.
 *
 * MEASURED by `scripts/always-on-audit.ts` over 30 days / 259 turns: each was
 * surfaced on 259 of 259 turns and chosen ZERO times INSIDE that window. Last
 * calls were 66d, 66d, 43d and 37d — all predating the window, so this is
 * "earned nothing in the period measured", not "quiet lately".
 *
 * THE DEMOTION IS ONLY SAFE IF EACH STAYS REACHABLE, so there is one test per
 * tool asserting it comes back on its natural phrasing. Coverage was verified
 * per tool before the change, not assumed — a sweep of all 54 `addMatching`
 * name-patterns found that `classifyThought` had NO family at all, and
 * `rankNextActions`' only apparent hit was the SEO family matching the
 * substring "rank", which fires on marketing text and was never real coverage.
 * Family #14 was added for classifyThought as a PRECONDITION of demoting it.
 *
 * ⚠ createTask was flagged by the same audit (259 impressions, 0 calls in
 * window, last call 37d) and is deliberately NOT demoted. Its regression
 * fixture is a keyword-less action turn — literally "ok do it" — which matches
 * no family, no playbook, and none of the action-intent patterns in
 * `action-intent-detector.ts`. Demoting it would re-open the 2026-07-06 hole
 * where the operator could not create a task at all on that turn shape.
 * **A tool can be cold and still be the last path on a turn where every other
 * path is silent.** Usage is not the only criterion.
 */
describe("2026-09-19 CORE demotion — four tools, each path proven", () => {
  function toolset(): Record<string, unknown> {
    const allTools: Record<string, unknown> = {};
    for (let i = 1; i <= 60; i++) allTools[`extraTool-${i}`] = { name: `extraTool-${i}` };
    for (const name of [
      "searchMemories", "createTask", "completeTask",
      "classifyThought", "rankNextActions", "getBlindSpots", "dailyPulse",
    ]) allTools[name] = { name };
    return allTools;
  }

  it("a neutral turn no longer carries the four demoted tools — CORE survives (positive control)", async () => {
    const keys = Object.keys(await pruneTools("standard", toolset(), "how are things looking", [0.1, 0.2]));
    expect(keys).not.toContain("classifyThought");
    expect(keys).not.toContain("rankNextActions");
    expect(keys).not.toContain("getBlindSpots");
    expect(keys).not.toContain("dailyPulse");
    // Positive control — without this, gutting CORE entirely would also pass.
    expect(keys).toContain("searchMemories");
    expect(keys).toContain("createTask");
  });

  it("createTask is NOT demoted — the keyword-less action turn still reaches it", async () => {
    // The 2026-07-06 regression fixture, re-asserted here because the audit
    // flagged createTask and the number alone argued for demoting it.
    const keys = Object.keys(await pruneTools("standard", toolset(), "ok do it"));
    expect(keys).toContain("createTask");
  });

  it("overthinking phrasing re-surfaces classifyThought via family #14", async () => {
    const keys = Object.keys(await pruneTools("standard", toolset(), "am I overthinking this", [0.1, 0.2]));
    expect(keys).toContain("classifyThought");
  });

  it("next-action phrasing re-surfaces rankNextActions via the execute playbook", async () => {
    const keys = Object.keys(await pruneTools("standard", toolset(), "what should i do next", [0.1, 0.2]));
    expect(keys).toContain("rankNextActions");
  });

  it("blind-spot phrasing re-surfaces getBlindSpots via the reflect playbook", async () => {
    const keys = Object.keys(await pruneTools("standard", toolset(), "what are my blind spots", [0.1, 0.2]));
    expect(keys).toContain("getBlindSpots");
  });

  it("routine phrasing re-surfaces dailyPulse via the routines family", async () => {
    const keys = Object.keys(await pruneTools("standard", toolset(), "give me my daily pulse", [0.1, 0.2]));
    expect(keys).toContain("dailyPulse");
  });
});
