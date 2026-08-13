/**
 * BDN-208 · conditions-aware commitment outcomes (pure halves).
 *
 * Pins the classification predicates (short-sleep line = 6h, matching
 * the sleep analyzer) and that the stats read model keeps outcome
 * classes separate — completed-under-short-sleep vs abandoned-under-
 * short-sleep is exactly the contrast the mechanism exists to expose.
 */
import { describe, it, expect } from "vitest";
import {
  classifyConditions,
  conditionedCompletionStats,
} from "@/lib/services/commitment-conditions";

describe("classifyConditions", () => {
  it("tags short sleep below 6h and rested at/above", () => {
    expect(classifyConditions({ sleepHours: 5.5, energy: null, stress: null })).toContain("short_sleep");
    expect(classifyConditions({ sleepHours: 6, energy: null, stress: null })).toContain("rested");
  });

  it("reports conditions_unknown when nothing was measured — never a fake bucket", () => {
    expect(classifyConditions({ sleepHours: null, energy: null, stress: null })).toEqual(["conditions_unknown"]);
  });

  it("stacks independent tags (short sleep + low energy + high stress)", () => {
    const tags = classifyConditions({ sleepHours: 4, energy: 1, stress: 5 });
    expect(tags).toEqual(expect.arrayContaining(["short_sleep", "low_energy", "high_stress"]));
  });
});

describe("conditionedCompletionStats", () => {
  it("splits outcomes per condition tag so completion-vs-abandon contrast is readable", () => {
    const stats = conditionedCompletionStats([
      { outcome: "completed", sleepHours: 8, energy: null, stress: null },
      { outcome: "completed", sleepHours: 7, energy: null, stress: null },
      { outcome: "abandoned", sleepHours: 4, energy: null, stress: null },
      { outcome: "broken", sleepHours: 5, energy: null, stress: null },
    ]);
    expect(stats.rested.completed).toBe(2);
    expect(stats.rested.total).toBe(2);
    expect(stats.short_sleep.abandoned).toBe(1);
    expect(stats.short_sleep.broken).toBe(1);
    expect(stats.short_sleep.completed).toBe(0);
  });
});
