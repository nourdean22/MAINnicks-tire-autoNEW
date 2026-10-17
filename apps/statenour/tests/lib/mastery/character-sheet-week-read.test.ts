/**
 * W4 fix round 1, P2 (review lens): the character sheet's 7-day window is a READ, and a failed read
 * is not "nothing gained this week" (skill empty-vs-error).
 *
 * THE DEFECT. computeCharacterSheet caught the weekly MasteryScore groupBy with `.catch(() => [])`,
 * and the weekly XP-event read fell back to a scan that also caught to `[]`, so a failed read gave
 * every stat rising7dXp 0, and the Stats verdict printed "Nothing gained XP this week." as fact.
 *
 * The fix: every stat carries `rising7dUnknown: true` when either half of the weekly read failed
 * (rising7dXp stays a number for the other consumers), and the verdict says the week could not be
 * read instead of naming a riser or claiming none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  groupBy: vi.fn(),
  weekEvents: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    masteryScore: { groupBy: (...a: unknown[]) => h.groupBy(...a) },
    lifeGoal: { findMany: async () => [] },
  },
}));
vi.mock("@/lib/mastery/credit", () => ({
  xpEventTotals: async () => new Map<string, number>(),
  // The swallowing variant other callers keep; the sheet must not read through it.
  xpEventTotalsSince: async () => new Map<string, number>(),
  xpEventTotalsSinceOrNull: (...a: unknown[]) => h.weekEvents(...a),
}));

import { computeCharacterSheet } from "@/lib/mastery/character-sheet";
import { statsVerdict } from "@/components/stats/stats-verdict";

const isWeekly = (arg: unknown) => Boolean((arg as { where?: unknown }).where);

beforeEach(() => {
  h.groupBy.mockReset();
  h.weekEvents.mockReset();
});

describe("computeCharacterSheet: the weekly window is a read with a state", () => {
  it("marks every stat rising7dUnknown when the weekly MasteryScore read fails", async () => {
    h.groupBy.mockImplementation(async (arg: unknown) => {
      if (isWeekly(arg)) throw new Error("connection reset");
      return [];
    });
    h.weekEvents.mockResolvedValue(new Map());
    const sheet = await computeCharacterSheet();
    expect(sheet.length).toBeGreaterThan(0);
    expect(sheet.every((s) => s.rising7dUnknown === true), "a failed weekly read still reads as a measured zero").toBe(true);
  });

  it("marks every stat rising7dUnknown when the weekly XP-event read fails", async () => {
    h.groupBy.mockResolvedValue([]);
    h.weekEvents.mockResolvedValue(null);
    const sheet = await computeCharacterSheet();
    expect(sheet.every((s) => s.rising7dUnknown === true)).toBe(true);
  });

  it("leaves the flag off when both weekly reads answered, even with zero XP (a real zero)", async () => {
    h.groupBy.mockResolvedValue([]);
    h.weekEvents.mockResolvedValue(new Map());
    const sheet = await computeCharacterSheet();
    expect(sheet.some((s) => s.rising7dUnknown)).toBe(false);
  });
});

const stat = (label: string, level: number, rising7dXp: number, rising7dUnknown?: boolean) => ({
  label,
  shortLabel: label,
  level,
  rising7dXp,
  ...(rising7dUnknown ? { rising7dUnknown } : {}),
});

describe("statsVerdict: never a weekly claim it cannot back", () => {
  it("says the week could not be read instead of 'Nothing gained XP this week.'", () => {
    const v = statsVerdict([stat("Focus", 7, 0, true), stat("Strength", 5, 0, true)]);
    expect(v).toBe("Total level 12 across 2 stats. This week's XP couldn't be read.");
    expect(v).not.toMatch(/nothing gained/i);
  });

  it("prints a sub-1 riser with one decimal, never '+0 XP'", () => {
    const v = statsVerdict([stat("Focus", 7, 0.3), stat("Strength", 5, 0)]);
    expect(v).toBe("Total level 12 across 2 stats. Focus gained the most this week, +0.3 XP.");
    expect(v).not.toContain("+0 XP");
  });
});
