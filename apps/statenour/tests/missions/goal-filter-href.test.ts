/**
 * W8c item 7 · the ?goalId= filter keeps the other params on /missions (?inspect= opens the universal task
 * inspector): tapping a goal chip merges goalId into the current query instead of replacing it.
 */
import { describe, expect, it } from "vitest";

import { goalFilterHref } from "@/lib/missions/task-goal";

describe("goalFilterHref", () => {
  it("with no current params it is the plain filter link (the goal card's deep link is unchanged)", () => {
    expect(goalFilterHref("g1")).toBe("/missions?goalId=g1");
    expect(goalFilterHref(null)).toBe("/missions");
  });

  it("keeps ?inspect= when a chip sets the filter", () => {
    expect(goalFilterHref("g1", "inspect=task%3At9")).toBe("/missions?inspect=task%3At9&goalId=g1");
  });

  it("keeps ?inspect= when a chip clears the filter, and replaces an old goalId rather than adding a second", () => {
    expect(goalFilterHref(null, "inspect=t9&goalId=g1")).toBe("/missions?inspect=t9");
    expect(goalFilterHref("g2", new URLSearchParams("goalId=g1&inspect=t9"))).toBe("/missions?inspect=t9&goalId=g2");
  });

  it("encodes the goal id the way the goal card's link always has", () => {
    expect(goalFilterHref("a b&c")).toBe("/missions?goalId=a%20b%26c");
  });
});
