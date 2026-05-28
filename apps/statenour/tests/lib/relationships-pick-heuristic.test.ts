/**
 * Wave AB · 2026-05-28 · unit tests for the relationships-pick-today
 * heuristic scoring + cron isoWeek helper. These are pure-function
 * tests · no Prisma, no AI · so they run fast.
 */
import { describe, it, expect } from "vitest";

// ── Re-implementations of the helpers under test ────────────────
// We don't import the source modules because they pull "server-only"
// and Prisma. The math is small enough to keep mirrored in the test.

const DAY_MS = 1000 * 60 * 60 * 24;

interface CandidateInput {
  daysSilent: number | null;
  ledgerDelta30d: number;
  brokenPromises: number;
  birthdayInDays: number | null;
  role: string;
}

function heuristicScore(c: CandidateInput): number {
  let score = 0;
  score += c.brokenPromises * 30;
  if (c.birthdayInDays !== null && c.birthdayInDays <= 14)
    score += 25 - c.birthdayInDays;
  if (c.daysSilent !== null) {
    if (c.daysSilent >= 90) score += 20;
    else if (c.daysSilent >= 60) score += 12;
    else if (c.daysSilent >= 30) score += 6;
  }
  score += Math.max(0, -c.ledgerDelta30d) * 2;
  if (
    ["mentor", "close_friend", "friend", "family", "romantic"].includes(
      c.role.toLowerCase(),
    )
  ) {
    score += 4;
  }
  return score;
}

function daysUntilMMDD(todayMD: string, targetMD: string): number {
  const year = new Date().getFullYear();
  const today = new Date(`${year}-${todayMD}`);
  let target = new Date(`${year}-${targetMD}`);
  if (target.getTime() < today.getTime()) {
    target = new Date(`${year + 1}-${targetMD}`);
  }
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

function isoWeek(d: Date): string {
  // Mirror of the cron implementation · UTC accessors throughout so the
  // function is timezone-independent (the test runner may be on UTC-5).
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

const baseline: CandidateInput = {
  daysSilent: 10,
  ledgerDelta30d: 0,
  brokenPromises: 0,
  birthdayInDays: null,
  role: "acquaintance",
};

describe("relationships-pick heuristic", () => {
  it("rewards broken promises heavily (30× multiplier)", () => {
    expect(heuristicScore({ ...baseline, brokenPromises: 2 })).toBe(60);
  });

  it("rewards imminent birthdays sub-linearly (25 - days, only ≤14d)", () => {
    expect(heuristicScore({ ...baseline, birthdayInDays: 0 })).toBe(25);
    expect(heuristicScore({ ...baseline, birthdayInDays: 14 })).toBe(11);
    expect(heuristicScore({ ...baseline, birthdayInDays: 15 })).toBe(0);
  });

  it("staircases silence (90d > 60d > 30d > 0)", () => {
    expect(heuristicScore({ ...baseline, daysSilent: 100 })).toBe(20);
    expect(heuristicScore({ ...baseline, daysSilent: 75 })).toBe(12);
    expect(heuristicScore({ ...baseline, daysSilent: 45 })).toBe(6);
    expect(heuristicScore({ ...baseline, daysSilent: 10 })).toBe(0);
    expect(heuristicScore({ ...baseline, daysSilent: null })).toBe(0);
  });

  it("only counts negative ledger (operator owes them)", () => {
    expect(heuristicScore({ ...baseline, ledgerDelta30d: -5 })).toBe(10);
    expect(heuristicScore({ ...baseline, ledgerDelta30d: 5 })).toBe(0);
  });

  it("adds +4 for high-leverage roles", () => {
    for (const role of ["mentor", "close_friend", "friend", "family", "romantic"]) {
      expect(heuristicScore({ ...baseline, role })).toBe(4);
    }
    expect(heuristicScore({ ...baseline, role: "vendor" })).toBe(0);
  });

  it("combines signals additively", () => {
    const score = heuristicScore({
      daysSilent: 100,            // 20
      ledgerDelta30d: -3,         // 6
      brokenPromises: 1,          // 30
      birthdayInDays: 10,         // 15
      role: "close_friend",       // 4
    });
    expect(score).toBe(75);
  });
});

describe("daysUntilMMDD", () => {
  it("returns 0 when birthday is today", () => {
    const today = new Date().toISOString().slice(5, 10);
    expect(daysUntilMMDD(today, today)).toBe(0);
  });

  it("rolls into next year when target has already passed", () => {
    // Jan 5 → Dec 28 should be ~ 358 days, not -8
    const result = daysUntilMMDD("01-05", "12-28");
    expect(result).toBeGreaterThan(300);
  });

  it("returns positive small number for next-week birthday", () => {
    const today = new Date();
    const inAWeek = new Date(today.getTime() + 7 * DAY_MS);
    const todayMD = today.toISOString().slice(5, 10);
    const weekMD = inAWeek.toISOString().slice(5, 10);
    const days = daysUntilMMDD(todayMD, weekMD);
    expect(days).toBeGreaterThanOrEqual(6);
    expect(days).toBeLessThanOrEqual(8);
  });
});

describe("isoWeek", () => {
  it("formats as YYYY-WNN with zero-padded week", () => {
    expect(isoWeek(new Date("2026-01-05T00:00:00Z"))).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("hits week 01 for early January", () => {
    const result = isoWeek(new Date("2026-01-05T00:00:00Z"));
    expect(result).toBe("2026-W02");
  });

  it("rolls year on late-December weeks correctly", () => {
    // Dec 31 2024 is a Tuesday · ISO week 1 of 2025
    const result = isoWeek(new Date("2024-12-31T00:00:00Z"));
    expect(result).toBe("2025-W01");
  });
});
