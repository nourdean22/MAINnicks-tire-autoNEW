import { describe, it, expect } from "vitest";
import { formatReward } from "@/lib/mastery/task-reward";

describe("formatReward", () => {
  it("shows real XP when credited", () => {
    expect(formatReward({ xpCredited: 12, goalLifted: false })).toBe("✓ +12 XP");
  });

  it("shows fractional real XP to one decimal (stat weights can be e.g. 1.4)", () => {
    expect(formatReward({ xpCredited: 1.4, goalLifted: false })).toBe("✓ +1.4 XP");
  });

  it("NEVER labels a stat COUNT as XP — count shows 'N stats credited'", () => {
    // The bug this fix closes: xpCredited unknown (null) but 2 stats credited.
    const out = formatReward({ xpCredited: null, statsCredited: 2, goalLifted: false });
    expect(out).toBe("✓ 2 stats credited");
    expect(out).not.toContain("XP");
    expect(formatReward({ xpCredited: null, statsCredited: 1, goalLifted: false })).toBe(
      "✓ 1 stat credited",
    );
  });

  it("prefers real XP over the count when both are present", () => {
    expect(formatReward({ xpCredited: 3, statsCredited: 2, goalLifted: false })).toBe("✓ +3 XP");
  });

  it("shows goal progress when the task was goal-tagged", () => {
    expect(formatReward({ xpCredited: 0, goalLifted: true })).toBe("✓ goal progress logged");
  });

  it("shows a streak of 2+ days", () => {
    expect(formatReward({ xpCredited: 0, goalLifted: false, streak: 5 })).toBe("✓ 🔥 5-day streak");
  });

  it("combines XP, goal, and streak", () => {
    expect(formatReward({ xpCredited: 8, goalLifted: true, streak: 3 })).toBe(
      "✓ +8 XP · goal progress logged · 🔥 3-day streak",
    );
  });

  it("never invents XP — 0 / unknown XP with no count is not shown as XP", () => {
    expect(formatReward({ xpCredited: 0, goalLifted: true })).not.toContain("XP");
    expect(formatReward({ xpCredited: null, goalLifted: true })).not.toContain("XP");
    // a 0 count is not shown either
    expect(formatReward({ xpCredited: null, statsCredited: 0, goalLifted: true })).toBe(
      "✓ goal progress logged",
    );
  });

  it("omits a 1-day streak (not worth a toast)", () => {
    expect(formatReward({ xpCredited: 0, goalLifted: false, streak: 1 })).toBeNull();
  });

  it("returns null when there is nothing worth showing", () => {
    expect(formatReward({ xpCredited: 0, goalLifted: false, streak: 0 })).toBeNull();
    expect(formatReward({ xpCredited: null, statsCredited: 0, goalLifted: false, streak: null })).toBeNull();
    expect(formatReward(null)).toBeNull();
    expect(formatReward(undefined)).toBeNull();
  });
});
