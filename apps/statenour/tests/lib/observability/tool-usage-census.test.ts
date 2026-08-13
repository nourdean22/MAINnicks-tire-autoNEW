/**
 * BDN-202 · tool-usage census + rewrite-candidate selection.
 *
 * Pins the MECHANISM (bucket predicates + the disclosed confound),
 * not just shapes: a tool with zero telemetry lands in neverInvoked,
 * a ≥10-call <60% tool lands in highFailure, and the caveat text that
 * makes a zero honest is part of the payload contract.
 */
import { describe, it, expect } from "vitest";
import { assembleToolUsageCensus } from "@/lib/observability/tool-usage-census";
import { pickRewriteCandidates, buildRewritePrompt } from "@/lib/ai/tool-description-rewrite";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import type { ToolStat } from "@/lib/ai/tool-telemetry";

const NOW = Date.UTC(2026, 7, 13);

function stat(partial: Partial<ToolStat> & { toolName: string }): ToolStat {
  return {
    totalCalls: 0,
    successRate: 1,
    avgDurationMs: 0,
    failCount: 0,
    lastCallAt: NOW,
    lastErrors: [],
    ...partial,
  };
}

describe("assembleToolUsageCensus", () => {
  it("splits catalog into neverInvoked / highFailure / stale by the stated predicates", () => {
    const names = TOOL_CATALOG.map((t) => t.name);
    const invoked = names[0];
    const failing = names[1];
    const staleTool = names[2];
    const census = assembleToolUsageCensus(
      [
        stat({ toolName: invoked, totalCalls: 5, successRate: 0.9 }),
        stat({
          toolName: failing,
          totalCalls: 20,
          successRate: 0.4,
          lastErrors: [{ message: "boom", at: NOW }],
        }),
        stat({ toolName: staleTool, totalCalls: 3, successRate: 1, lastCallAt: NOW - 40 * 86_400_000 }),
      ],
      NOW,
    );
    expect(census.catalogSize).toBe(TOOL_CATALOG.length);
    expect(census.invokedCount).toBe(3);
    expect(census.neverInvoked.length).toBe(TOOL_CATALOG.length - 3);
    expect(census.highFailure.map((r) => r.name)).toEqual([failing]);
    expect(census.highFailure[0].lastError).toBe("boom");
    expect(census.stale.map((r) => r.name)).toEqual([staleTool]);
  });

  it("does NOT flag high failure below 10 calls (one bad afternoon is not a verdict)", () => {
    const name = TOOL_CATALOG[0].name;
    const census = assembleToolUsageCensus([stat({ toolName: name, totalCalls: 9, successRate: 0 })], NOW);
    expect(census.highFailure).toEqual([]);
  });

  it("carries the pruner-confound caveat in the payload — a zero must not read as useless", () => {
    const census = assembleToolUsageCensus([], NOW);
    expect(census.caveat).toMatch(/pruner-confounded/);
    expect(census.caveat).toMatch(/never auto-delete/i);
  });
});

describe("pickRewriteCandidates", () => {
  it("selects only ≥10-call, <60%-success tools WITH failure evidence, worst first, capped at 3", () => {
    const mk = (n: string, calls: number, rate: number, errs = 1) =>
      stat({
        toolName: n,
        totalCalls: calls,
        successRate: rate,
        lastErrors: Array.from({ length: errs }, () => ({ message: "e", at: NOW })),
      });
    const picked = pickRewriteCandidates([
      mk("a", 50, 0.1),
      mk("b", 50, 0.3),
      mk("c", 50, 0.5),
      mk("d", 50, 0.55),
      mk("healthy", 50, 0.95),
      mk("thin", 5, 0.0),
      stat({ toolName: "noEvidence", totalCalls: 50, successRate: 0.2, lastErrors: [] }),
    ]);
    expect(picked.map((p) => p.toolName)).toEqual(["a", "b", "c"]);
  });
});

describe("buildRewritePrompt", () => {
  it("includes the tool name, current description, failures, and the drafts-only rules", () => {
    const prompt = buildRewritePrompt({
      toolName: "getTasks",
      currentDescription: "Get tasks",
      failures: [{ message: "invalid status arg" }],
    });
    expect(prompt).toContain("getTasks");
    expect(prompt).toContain("Get tasks");
    expect(prompt).toContain("invalid status arg");
    expect(prompt).toMatch(/under 500 characters/);
    expect(prompt).toMatch(/ONLY the new description/);
  });
});
