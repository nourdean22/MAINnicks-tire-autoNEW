/**
 * Mastery leveling engine tests · 2026-05-30
 * Locks the XP curve, the level inverse, progress math, tiers, and the
 * loss-aversion decay so the "leveling up" feel can't silently drift.
 */
import { describe, it, expect } from "vitest";
import {
  SIGNAL_XP,
  xpForLevel,
  levelFromXp,
  levelProgress,
  tierForLevel,
  decayXp,
} from "@/lib/mastery/leveling";

describe("xpForLevel · the curve", () => {
  it("level 1 costs 0 XP (everyone starts at 1)", () => {
    expect(xpForLevel(1)).toBe(0);
  });
  it("is gentle early, steep late (quadratic)", () => {
    expect(xpForLevel(2)).toBe(5);
    expect(xpForLevel(3)).toBe(15);
    expect(xpForLevel(5)).toBe(50);
    expect(xpForLevel(10)).toBe(225);
  });
  it("clamps sub-1 levels to the level-1 floor", () => {
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(-3)).toBe(0);
  });
});

describe("levelFromXp · inverse of xpForLevel", () => {
  it("0 or negative XP is level 1, never 0", () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(-10)).toBe(1);
  });
  it("lands exactly on each threshold", () => {
    for (const L of [1, 2, 3, 5, 8, 10, 13]) {
      expect(levelFromXp(xpForLevel(L))).toBe(L);
    }
  });
  it("XP just below a threshold stays on the lower level", () => {
    expect(levelFromXp(xpForLevel(5) - 0.1)).toBe(4);
    expect(levelFromXp(xpForLevel(5))).toBe(5);
  });
});

describe("levelProgress", () => {
  it("reports progress toward the next level", () => {
    // level 4 floor = 30, level 5 = 50 → span 20. xp 40 = halfway.
    const p = levelProgress(40);
    expect(p.level).toBe(4);
    expect(p.xpIntoLevel).toBe(10);
    expect(p.xpForNext).toBe(20);
    expect(p.progressPct).toBe(50);
  });
  it("a fresh stat is level 1, 0% in", () => {
    const p = levelProgress(0);
    expect(p.level).toBe(1);
    expect(p.xpIntoLevel).toBe(0);
    expect(p.progressPct).toBe(0);
  });
});

describe("tierForLevel · Greene arc", () => {
  it("maps levels to the apprenticeship → mastery tiers", () => {
    expect(tierForLevel(1).name).toBe("Apprentice");
    expect(tierForLevel(4).name).toBe("Active");
    expect(tierForLevel(7).name).toBe("Practitioner");
    expect(tierForLevel(10).name).toBe("Mastery");
    expect(tierForLevel(13).name).toBe("Transcendent");
  });
});

describe("decayXp · loss aversion", () => {
  it("does nothing inside the grace window", () => {
    expect(decayXp(100, 7)).toBe(100);
    expect(decayXp(100, 3)).toBe(100);
  });
  it("bleeds XP once neglected past grace", () => {
    const after = decayXp(100, 17); // 10 days past 7-day grace
    expect(after).toBeLessThan(100);
    expect(after).toBeGreaterThan(85); // ~1%/day compounding ≈ 90
  });
  it("never goes negative", () => {
    expect(decayXp(0.1, 9999)).toBe(0);
  });
});

describe("SIGNAL_XP · event taxonomy", () => {
  it("covers every life-signal a rep can come from", () => {
    expect(Object.keys(SIGNAL_XP).sort()).toEqual(
      ["chat", "decision", "email", "habit", "journal", "task"].sort(),
    );
  });
  it("weights deliberate signals (decision/task) above ambient (chat)", () => {
    expect(SIGNAL_XP.decision).toBeGreaterThan(SIGNAL_XP.chat);
    expect(SIGNAL_XP.task).toBeGreaterThan(SIGNAL_XP.habit);
  });
});
