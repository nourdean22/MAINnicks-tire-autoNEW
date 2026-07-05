/**
 * Regression · brain-context 3s-timeout contract (2026-07-04 audit,
 * PLAUSIBLE finding → code-verified).
 *
 * The module's own header promises every context block loads with a
 * 3s timeout "so a single slow query can't tank the whole chat" — but
 * the six "newly moved fetchers" (detectCrossSessionThread,
 * getContextualMemories, prefetchIntents, recallMemoriesForQuery,
 * buildTruthGroundingBlock, findRelevantContradictions) and the serial
 * anticipateMemories call (an LLM call!) were awaited with bare
 * .catch() — unbounded stream-open latency under Neon brownouts.
 *
 * Source-scan pin (same spirit as the chat-mode mirror tests): every
 * one of those calls must be wrapped in withTimeout(. This is a
 * structural guard — if a refactor unwraps one, this fails with the
 * fetcher's name.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(__dirname, "../../lib/services/chat/brain-context.ts"),
  "utf8",
);

const HOT_PATH_FETCHERS = [
  "detectCrossSessionThread",
  "getContextualMemories",
  "prefetchIntents",
  "recallMemoriesForQuery",
  "buildTruthGroundingBlock",
  "findRelevantContradictions",
  "anticipateMemories",
];

describe("brain-context · every hot-path fetcher honors the 3s timeout contract", () => {
  for (const fn of HOT_PATH_FETCHERS) {
    it(`${fn} is wrapped in withTimeout(`, () => {
      // Every CALL site of the fetcher must sit inside a withTimeout(
      // wrapper: find each `fn(` occurrence and require "withTimeout("
      // within the 120 chars preceding it (import lines don't call).
      const callSites = [...src.matchAll(new RegExp(`${fn}\\(`, "g"))]
        .map((m) => m.index!)
        .filter((i) => {
          const before = src.slice(Math.max(0, i - 200), i);
          return !/import|from ["']/.test(src.slice(i, i + 80)) && !before.includes(`* `);
        });
      expect(callSites.length).toBeGreaterThan(0);
      for (const i of callSites) {
        const windowBefore = src.slice(Math.max(0, i - 120), i);
        expect(
          windowBefore.includes("withTimeout("),
          `${fn} call at offset ${i} is not wrapped in withTimeout( — unbounded stream-open latency`,
        ).toBe(true);
      }
    });
  }
});
