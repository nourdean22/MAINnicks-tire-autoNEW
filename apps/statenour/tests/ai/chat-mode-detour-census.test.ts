/**
 * B3 (job 2026-11-01-chat-humanizer-w6): Nick should call the tool it needs in the first step,
 * not reach it through searchTools / invokeTool.
 *
 * Measured 2026-11-02 (read-only, Nour's go; notes chat-b3-tool-lookups-data.md): 221 turns in
 * 14 days, the budget cut 148 of them (67%), candidates p50 37 against a budget of 24; invokeTool
 * reached githubSearchCode 8, searchColdMemory 8, queryNickstire 6, getEstimateLeaks 4,
 * getCommitments / getHealthToday / completeCommitment 3 each, getTasks / getReviewStats /
 * githubListRepos 2 each.
 *
 * One phrasing per target, through the REAL pruner and the REAL catalog, at the default budget
 * (no NICK_TOOL_BUDGET). Embeddings are left out on purpose: the semantic tier only adds tools,
 * so a phrasing that reaches its tool here reaches it with embeddings too.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/ai/tool-selection-telemetry", () => ({ recordToolSelection: vi.fn(async () => undefined) }));

import { pruneTools } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

const allTools = Object.fromEntries(TOOL_CATALOG.map((t) => [t.name, { name: t.name }]));

const CENSUS: Array<[tool: string, phrasing: string]> = [
  ["githubSearchCode", "search the repo code for where the retry gate lives"],
  ["searchColdMemory", "what did I say about the shop lease back in the spring"],
  ["queryNickstire", "how many invoices did the shop close today"],
  ["getEstimateLeaks", "which estimates did customers walk away from this week"],
  ["getCommitments", "what did I commit to this week"],
  ["getHealthToday", "how did I sleep and what's my health today"],
  ["completeCommitment", "mark the commitment to call the supplier done"],
  ["getTasks", "what's on my task list"],
  ["getReviewStats", "how are our google reviews doing"],
  ["githubListRepos", "list my github repos"],
];

afterEach(() => {
  delete process.env.NICK_TOOL_BUDGET;
});

describe("B3 · the tools invokeTool reached most are offered in the first step", () => {
  it.each(CENSUS)("%s is offered for %j", async (tool, phrasing) => {
    const offered = Object.keys(await pruneTools("standard", allTools, phrasing, []));
    expect(offered).toContain(tool);
  });

  it("POSITIVE CONTROL: the budget binds here, so the census measures the cut, not an empty catalog", async () => {
    expect(Object.keys(allTools).length).toBeGreaterThan(40);
    // The lease phrasing fills the default budget exactly: 32 offered, more candidates cut.
    const offered = Object.keys(await pruneTools("standard", allTools, "what did I say about the shop lease back in the spring", []));
    expect(offered.length).toBe(32);
  });

  it("the env override still wins over the default budget", async () => {
    process.env.NICK_TOOL_BUDGET = "12";
    const offered = Object.keys(await pruneTools("standard", allTools, "what did I say about the shop lease back in the spring", []));
    expect(offered.length).toBeLessThanOrEqual(12);
  });
});
