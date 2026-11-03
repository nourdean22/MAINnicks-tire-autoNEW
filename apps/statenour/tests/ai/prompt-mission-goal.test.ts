/**
 * W8a (audit C9): Nick's prompt mission block names each mission's goal (id and title), so "add a task for the
 * second-tech mission" can land on the goal's ladder. A mission with no goal says nothing extra. CATEGORY_DOMAINS
 * knows goal_moment (C13) so the /brain categories page can place it.
 */
import { describe, expect, it } from "vitest";

import { renderWhyBlock } from "@/lib/ai/prompt/v2/renderer";
import type { NickPrimeContext } from "@/lib/ai/context/nick-prime-context";
import { CATEGORY_DOMAINS } from "@/lib/brain/categories";

const ctx = (goal: { id: string; title: string } | null): NickPrimeContext =>
  ({
    activeGoals: [],
    activeMissions: [{ id: "m1", title: "Second tech", domain: "BUSINESS", priority: 7, successMetric: "hired", goal }],
  }) as unknown as NickPrimeContext;

describe("Active Missions block · the mission's goal", () => {
  it("names the goal with its id on the mission's own line", () => {
    const line = renderWhyBlock(ctx({ id: "g1", title: "Grow revenue" })).split("\n").find((l) => l.includes("Second tech")) ?? "";
    expect(line).toContain("goal: Grow revenue [goalId:g1]");
  });
  it("a mission with no goal says nothing about one", () => {
    const line = renderWhyBlock(ctx(null)).split("\n").find((l) => l.includes("Second tech")) ?? "";
    expect(line).not.toContain("goal");
  });
});

describe("CATEGORY_DOMAINS", () => {
  it("places goal_moment beside goal", () => {
    const group = Object.entries(CATEGORY_DOMAINS).find(([, cats]) => cats.includes("goal"));
    expect(group).toBeDefined();
    expect(group![1]).toContain("goal_moment");
  });
});
