/**
 * Greene seed integrity + static prompt budget · 2026-07-27.
 *
 * `pnpm prompt:size-check` measures the real system prompt, but it calls
 * buildSystemPrompt → Prisma and so cannot run without a live DATABASE_URL
 * — which means the single largest fixed contributor to that prompt has no
 * guard in CI, on a laptop without a DB, or in this repo's containers.
 *
 * That contributor is StrategicLaw. `finalize-system-prompt` does:
 *
 *     prisma.strategicLaw.findMany(...)        // NO take, NO pagination
 *       .map(l => `[${l.book} #${l.number}] ${l.shortTitle}: ${l.essence}`)
 *       .join("\n")
 *
 * Every row, every anthropic turn, against MAX_SYSTEM_CHARS that already
 * truncates on heavy turns. But the rows are authored in seed files, so
 * the exact byte cost is computable statically — no DB needed. This file
 * does that, which turns an un-runnable check into one that runs on every
 * `pnpm test`.
 *
 * It covers only the rows this PR can see (mastery + expansion are the
 * exported sources); the other four books are counted, not measured. That
 * is stated rather than hidden — see EXPECTED_STRATEGIC_LAWS.
 */

import { describe, expect, it } from "vitest";

import { MASTERY_LAWS, } from "@/prisma/seeds/mastery";
import { GREENE_EXPANSION_ENTRIES } from "@/prisma/seeds/seed-greene-expansion";
import { EXPECTED_STRATEGIC_LAWS } from "@/prisma/seeds/seed-greene-all";

/** Byte-identical to finalize-system-prompt's greeneSummary line format. */
const promptLine = (l: {
  book: string;
  number: number;
  shortTitle: string;
  essence: string;
}) => `[${l.book} #${l.number}] ${l.shortTitle}: ${l.essence}`;

describe("Greene seed integrity", () => {
  it("keeps the expected-row arithmetic in sync with the exported sources", () => {
    // The four books without exported arrays, counted from their seed files.
    const UNEXPORTED = 48 /* 48-laws */ + 33 /* 33-strategies */ + 18 /* human-nature */ + 24; /* art-of-seduction */
    expect(UNEXPORTED + MASTERY_LAWS.length + GREENE_EXPANSION_ENTRIES.length).toBe(
      EXPECTED_STRATEGIC_LAWS,
    );
  });

  it("has no (book, number) collision between mastery and the expansion", () => {
    // Both seed MASTERY rows and both upsert on book_number — an overlap
    // means one silently overwrites the other depending on run order.
    // mastery.ts owns 1-12 and 21-29; the expansion owns 13-20.
    const masteryNums = MASTERY_LAWS.map((l) => l.number);
    const expansionMasteryNums = GREENE_EXPANSION_ENTRIES.filter(
      (e) => e.book === "MASTERY",
    ).map((e) => e.number);
    const overlap = masteryNums.filter((n) => expansionMasteryNums.includes(n));
    expect(overlap, `MASTERY numbers claimed twice: ${overlap.join(", ")}`).toEqual([]);
  });

  it("keeps every seeded book_number unique across both exported sources", () => {
    const keys = [
      ...MASTERY_LAWS.map((l) => `${l.book}#${l.number}`),
      ...GREENE_EXPANSION_ENTRIES.map((e) => `${e.book}#${e.number}`),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("static prompt budget · StrategicLaw → greeneSummary", () => {
  // MAX_SYSTEM_CHARS in finalize-system-prompt. Mirrored, not imported,
  // because importing that module pulls the whole chat route graph.
  const MAX_SYSTEM_CHARS = 65_000;

  const measurable = [
    ...MASTERY_LAWS.map((l) => promptLine(l)),
    ...GREENE_EXPANSION_ENTRIES.map((e) => promptLine(e)),
  ];
  const measuredChars = measurable.reduce((a, s) => a + s.length + 1, 0);
  const avgLine = measuredChars / measurable.length;
  const projectedTotal = avgLine * EXPECTED_STRATEGIC_LAWS;

  it("caps any single row's contribution", () => {
    // One runaway essence is the realistic failure mode — a well-written
    // 2000-char entry looks like good work in review and silently costs
    // every turn thereafter.
    for (const line of measurable) {
      expect(line.length, `over-long greeneSummary line: ${line.slice(0, 70)}…`).toBeLessThan(
        520,
      );
    }
  });

  /**
   * KNOWN DEFECT, CODIFIED — greeneSummary alone exceeds the whole cap.
   *
   * Projected full-table cost is ~68.6K chars against MAX_SYSTEM_CHARS of
   * 65K. The block is not merely large; it is bigger than the entire
   * budget it is nominally subject to. And it escapes that budget by
   * construction, because the ordering in the chat route is:
   *
   *   1. finalize-system-prompt · trimPromptToBudget(systemPrompt, 65_000)
   *   2. finalize-system-prompt · THEN query all 198 StrategicLaw rows
   *   3. augment-final-prompt   · append `${systemPrompt}\n…\n${greeneSummary}`
   *                               verbatim — no slice, no take, no cap
   *
   * The trim runs before the largest block is built, so the "budget" it
   * enforces is on everything except the thing most worth budgeting.
   *
   * This is pre-existing (the block predates the Book V rows, which add
   * ~3.0K to it). The test does NOT assert the healthy value, because
   * asserting a number the code cannot currently meet would just be a
   * permanently red test. It asserts the overage does not get WORSE —
   * a ratchet, so the next person to add rows has to make a deliberate
   * decision instead of an invisible one.
   *
   * The fix is a product decision, not a mechanical one: send the law
   * INDEX ambiently (book # + shortTitle ≈ 8K for all 198) and let the
   * model pull full essence on demand via the existing searchStrategicLaws
   * tool in lib/ai/tools/brain.ts. That would return ~60K per anthropic
   * turn. Deliberately not done here — it changes what Nick sees on every
   * turn and belongs in its own reviewed change.
   */
  it("ratchets the known greeneSummary overage — must not grow", () => {
    expect(
      projectedTotal,
      `greeneSummary projected at ${Math.round(projectedTotal)} chars — see the block comment above before raising this ceiling`,
    ).toBeLessThan(70_000);
  });

  it("documents that greeneSummary alone exceeds the system-prompt cap", () => {
    // Pinned deliberately: if a future change makes this false, the
    // defect is fixed and the ratchet above should be tightened to match.
    expect(projectedTotal).toBeGreaterThan(MAX_SYSTEM_CHARS);
  });
});
