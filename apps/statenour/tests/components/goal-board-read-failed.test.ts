/**
 * GoalBoard: a failed goals read never shows the first-goal onboarding
 * (audit 2026-10-10 · 02-F13).
 *
 * THE DEFECT. `load()` wrapped the read in `catch {}` and then rendered
 * `goals.length === 0` as "Type a goal above or tap AI suggest. Think big..."
 * So an operator with twenty active goals, on a failed read, was told to
 * write their first one.
 *
 * GoalBoard loads in an effect, which a static render never runs (vitest is
 * node-only here), so the branch decision is a pure helper in the component
 * file and this pins it. The catch wiring (`setLoadError`) is code-inspected.
 */
import { describe, expect, it } from "vitest";

import { goalListView } from "@/components/goals/goal-board";

describe("goalListView · unknown is not empty", () => {
  it("a failed read with nothing loaded is an error, not onboarding", () => {
    expect(goalListView(false, "upstream 500", 0)).toBe("error");
  });

  it("POSITIVE CONTROL: a successful read with no goals is the empty state", () => {
    expect(goalListView(false, null, 0)).toBe("empty");
  });

  it("a failed refresh keeps the goals already on screen", () => {
    expect(goalListView(false, "upstream 500", 3)).toBe("list");
  });

  it("loading wins over everything", () => {
    expect(goalListView(true, "upstream 500", 0)).toBe("loading");
    expect(goalListView(true, null, 3)).toBe("loading");
  });
});
