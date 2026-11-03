/**
 * The goal spine tools are offered on the words Nour actually types (job 2026-11-02-nour-os-interconnect
 * W1). Registration is not reachability: each tool is asserted through pruneTools on five phrasings.
 * "check in on" belongs to the relationship-picks family (#3440); a goal check-in must not carry
 * Nour's personal picks, and a person check-in must not carry logGoalCheckIn.
 */
import { describe, expect, it } from "vitest";
import { pruneTools } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

function allTools(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of TOOL_CATALOG) out[(t as { name: string }).name] = {};
  return out;
}
async function offered(prompt: string): Promise<string[]> {
  const pruned = (await pruneTools("standard" as never, allTools(), prompt)) as Record<string, unknown>;
  return Object.keys(pruned ?? {});
}

describe("getGoals reachability", () => {
  it.each([
    "how are my goals doing",
    "what goals do I have right now",
    "am I on track for my revenue goal",
    "which goal is falling behind",
    "link this task to my fitness goal",
  ])("%s", async (p) => {
    expect(await offered(p)).toContain("getGoals");
  });
});

describe("getRelated reachability", () => {
  it.each([
    "what's happened on my revenue goal lately",
    "show me everything related to the lift mission",
    "what have I done toward my fitness goal this month",
    "what's connected to this goal",
    "recent activity on the shop expansion project",
  ])("%s", async (p) => {
    expect(await offered(p)).toContain("getRelated");
  });
});

describe("logGoalCheckIn reachability", () => {
  it.each([
    "check in on my revenue goal: at risk, 5200 so far",
    "goal check-in: fitness is on track",
    "log a check-in for my savings goal",
    "my revenue goal is off track this week",
    "update my goal progress, I'm at 4 sessions",
  ])("%s", async (p) => {
    expect(await offered(p)).toContain("logGoalCheckIn");
  });
});

describe("controls", () => {
  it("an unrelated message pulls in none of them", async () => {
    const o = await offered("what's the weather tomorrow");
    expect(o).not.toContain("getGoals");
    expect(o).not.toContain("getRelated");
    expect(o).not.toContain("logGoalCheckIn");
  });

  it("a goal check-in never carries the personal relationship picks", async () => {
    expect(await offered("check in on my revenue goal: at risk")).not.toContain("getRelationshipPicks");
  });

  it("a person check-in still pulls the picks and not the goal write", async () => {
    const o = await offered("anyone I need to check in on?");
    expect(o).toContain("getRelationshipPicks");
    expect(o).not.toContain("logGoalCheckIn");
  });
});
