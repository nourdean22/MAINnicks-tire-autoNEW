import { describe, it, expect } from "vitest";
import { formatReward } from "@/lib/mastery/task-reward";

describe("formatReward", () => {
  it("shows real XP when credited", () => {
    expect(formatReward({ xp: 12, goalLifted: false })).toBe("✓ +12 XP");
  });

  it("shows goal progress when the task was goal-tagged", () => {
    expect(formatReward({ xp: 0, goalLifted: true })).toBe("✓ goal progress logged");
  });

  it("shows a streak of 2+ days", () => {
    expect(formatReward({ xp: 0, goalLifted: false, streak: 5 })).toBe("✓ 🔥 5-day streak");
  });

  it("combines all three", () => {
    expect(formatReward({ xp: 8, goalLifted: true, streak: 3 })).toBe(
      "✓ +8 XP · goal progress logged · 🔥 3-day streak",
    );
  });

  it("never invents XP — 0 XP is omitted (no fake credit)", () => {
    expect(formatReward({ xp: 0, goalLifted: true })).not.toContain("XP");
  });

  it("omits a 1-day streak (not worth a toast)", () => {
    expect(formatReward({ xp: 0, goalLifted: false, streak: 1 })).toBeNull();
  });

  it("returns null when there is nothing worth showing", () => {
    expect(formatReward({ xp: 0, goalLifted: false, streak: 0 })).toBeNull();
    expect(formatReward({ xp: 0, goalLifted: false, streak: null })).toBeNull();
    expect(formatReward(null)).toBeNull();
    expect(formatReward(undefined)).toBeNull();
  });
});
