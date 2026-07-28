/**
 * StrategicLaw · Mastery Book V (rows 21-29) · 2026-07-27.
 *
 * The nine creative strategies exist in TWO stores with different
 * consumers, and this file guards the StrategicLaw one:
 *
 *   BrainMemory(greene_law)  → chat matcher · reasoning engine ·
 *                              relationship sidebar   (guarded by
 *                              greene-creative-strategies.test.ts)
 *   StrategicLaw             → finalize-system-prompt (EVERY anthropic
 *                              turn) · ultron/adviser · tools/brain ·
 *                              tools/tasks             (guarded here)
 *
 * The load-bearing assertion is the prompt budget. `finalize-system-prompt`
 * maps every row into the system prompt as `[BOOK #N] shortTitle: essence`
 * with no cap and no pagination, against a 65K MAX_SYSTEM_CHARS ceiling
 * that already truncates on heavy turns. An unbounded `essence` added here
 * is paid on every single anthropic chat turn, forever — so it is pinned
 * to the convention the existing rows established rather than left to
 * drift.
 */

import { describe, expect, it } from "vitest";

import { MASTERY_LAWS } from "@/prisma/seeds/mastery";

const CREATIVE = MASTERY_LAWS.filter((l) => l.number >= 21);
const ESTABLISHED = MASTERY_LAWS.filter((l) => l.number <= 12);

/** Mirrors finalize-system-prompt's greeneSummary line format exactly. */
const promptLine = (l: (typeof MASTERY_LAWS)[number]) =>
  `[${l.book} #${l.number}] ${l.shortTitle}: ${l.essence}`;

describe("StrategicLaw · Mastery Book V creative strategies", () => {
  it("adds all 9 at numbers 21-29, clear of the 13-20 expansion range", () => {
    expect(CREATIVE).toHaveLength(9);
    expect(CREATIVE.map((l) => l.number)).toEqual([
      21, 22, 23, 24, 25, 26, 27, 28, 29,
    ]);
  });

  it("keeps (book, number) unique — the upsert key", () => {
    // seedMastery upserts on where: { book_number: { book, number } }.
    // A duplicate here means one row silently overwrites another.
    const keys = MASTERY_LAWS.map((l) => `${l.book}#${l.number}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("holds essence within the established convention — this is prompt budget", () => {
    const establishedMax = Math.max(...ESTABLISHED.map((l) => l.essence.length));
    for (const l of CREATIVE) {
      expect(
        l.essence.length,
        `#${l.number} ${l.shortTitle} essence is ${l.essence.length}, over the ${establishedMax} set by rows 1-12`,
      ).toBeLessThanOrEqual(establishedMax);
    }
  });

  it("caps what the nine add to every anthropic system prompt", () => {
    const added = CREATIVE.reduce((a, l) => a + promptLine(l).length + 1, 0);
    // ~3.0K against MAX_SYSTEM_CHARS 65_000 (~4.6%). The ceiling is a
    // tripwire, not a target: if a future edit pushes past it, that is a
    // deliberate budget decision and should be made deliberately.
    expect(added).toBeLessThan(3_200);
  });

  it("populates every field the four consumers read", () => {
    for (const l of CREATIVE) {
      expect(l.book).toBe("MASTERY");
      // greeneSummary renders shortTitle inline — keep it a label.
      expect(l.shortTitle.length, `#${l.number} shortTitle`).toBeLessThanOrEqual(30);
      expect(l.title.length, `#${l.number} title`).toBeGreaterThan(0);
      // tools/brain.ts text-searches these two; ultron/adviser renders them.
      expect(l.shopApplication.length, `#${l.number} shopApplication`).toBeGreaterThan(200);
      expect(l.nourApplication.length, `#${l.number} nourApplication`).toBeGreaterThan(200);
    }
  });

  it("carries snake_case triggerPatterns as a JSON string array", () => {
    // seedMastery does JSON.parse(law.triggerPatterns as string) — a raw
    // array here would throw at seed time, not at compile time.
    for (const l of CREATIVE) {
      expect(typeof l.triggerPatterns, `#${l.number} must be a JSON string`).toBe(
        "string",
      );
      const parsed = JSON.parse(l.triggerPatterns) as string[];
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length, `#${l.number} pattern count`).toBeGreaterThanOrEqual(5);
      for (const p of parsed) {
        // ultron/adviser matches on these; the table's convention is
        // lowercase snake_case tokens.
        expect(p, `#${l.number} pattern "${p}"`).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
      }
    }
  });

  it("does not reuse a triggerPattern across two strategies", () => {
    const seen = new Map<string, number>();
    for (const l of CREATIVE) {
      for (const p of JSON.parse(l.triggerPatterns) as string[]) {
        const owner = seen.get(p);
        expect(owner, `"${p}" shared by #${l.number} and #${owner}`).toBeUndefined();
        seen.set(p, l.number);
      }
    }
  });
});
