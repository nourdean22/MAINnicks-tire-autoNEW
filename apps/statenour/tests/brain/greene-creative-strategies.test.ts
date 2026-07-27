/**
 * Mastery Book V · the 9 creative strategies · 2026-07-27.
 *
 * These entries only produce value if they survive the whole pipeline:
 * corpus → seed script → BrainMemory(greene_law) → the chat matcher's
 * literal-substring scoring → the 40-candidate cap in
 * contextual-greene-laws. Each stage has a silent failure mode, so the
 * assertions here are pipeline guards, not prose checks:
 *
 *   · all 9 present + distinct keys      → nothing collapsed back together
 *   · matchPhrases lowercase + multiword → the matcher can actually hit
 *   · >= 2 phrases distinctive per entry → minScore 2 is reachable
 *   · relatedKeys resolve                → sidebar "related" footer works
 */

import { describe, expect, it } from "vitest";

import {
  ALL_GREENE_ENTRIES,
  CREATIVE_STRATEGIES,
} from "@/lib/brain/greene-corpus";

const EXPECTED_KEYS = [
  "mastery_authentic_voice",
  "mastery_great_yield",
  "mastery_mechanical_intelligence",
  "mastery_natural_powers",
  "mastery_open_field",
  "mastery_high_end",
  "mastery_evolutionary_hijack",
  "mastery_dimensional_thinking",
  "mastery_alchemical",
];

describe("Mastery Book V · creative strategies", () => {
  it("exposes all 9 strategies as distinct entries", () => {
    expect(CREATIVE_STRATEGIES).toHaveLength(9);
    expect(CREATIVE_STRATEGIES.map((e) => e.key).sort()).toEqual(
      [...EXPECTED_KEYS].sort(),
    );
  });

  it("numbers them 1-9 in Greene's order", () => {
    expect(CREATIVE_STRATEGIES.map((e) => e.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("keeps every key unique across the whole corpus", () => {
    const keys = ALL_GREENE_ENTRIES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries matchPhrases the chat matcher can actually hit", () => {
    for (const entry of CREATIVE_STRATEGIES) {
      const phrases = entry.matchPhrases ?? [];
      // minScore defaults to 2 · an entry needs enough surface area that
      // two independent phrases can fire on one real message.
      expect(phrases.length, `${entry.key} phrase count`).toBeGreaterThanOrEqual(8);
      for (const p of phrases) {
        // The matcher lowercases the message, not the phrase — an
        // uppercase phrase is permanently unmatchable.
        expect(p, `${entry.key} phrase casing`).toBe(p.toLowerCase());
        expect(p.trim(), `${entry.key} phrase padding`).toBe(p);
        // Single short tokens ("the", "it") would match everything and
        // crowd out genuinely relevant picks.
        expect(p.length, `${entry.key} phrase "${p}" too short`).toBeGreaterThan(3);
      }
      expect(new Set(phrases).size, `${entry.key} duplicate phrases`).toBe(
        phrases.length,
      );
    }
  });

  it("does not reuse a matchPhrase across two strategies", () => {
    // Overlap would make two entries fire on the same signal and split
    // the score, pushing both under minScore.
    const seen = new Map<string, string>();
    for (const entry of CREATIVE_STRATEGIES) {
      for (const p of entry.matchPhrases ?? []) {
        const owner = seen.get(p);
        expect(owner, `"${p}" duplicated by ${entry.key} and ${owner}`).toBeUndefined();
        seen.set(p, entry.key);
      }
    }
  });

  it("populates the fields every downstream consumer reads", () => {
    for (const entry of CREATIVE_STRATEGIES) {
      expect(entry.book).toBe("Mastery");
      expect(entry.type).toBe("creative_strategy");
      expect(entry.title.length, `${entry.key} title`).toBeGreaterThan(0);
      expect(entry.summary.length, `${entry.key} summary`).toBeGreaterThan(20);
      expect(entry.fullText.length, `${entry.key} fullText`).toBeGreaterThan(100);
      // The digest cron's AI applicability check reads these.
      expect(entry.triggers.length, `${entry.key} triggers`).toBeGreaterThanOrEqual(2);
      expect(
        entry.applicabilityPrompt.length,
        `${entry.key} applicabilityPrompt`,
      ).toBeGreaterThan(20);
      // renderGreeneBlock turns these into "→ move:" lines.
      expect(entry.actions.length, `${entry.key} actions`).toBeGreaterThanOrEqual(3);
      for (const a of entry.actions) {
        expect(a.length, `${entry.key} action "${a}"`).toBeGreaterThan(15);
      }
    }
  });

  it("resolves every relatedKey to a real corpus entry", () => {
    const allKeys = new Set(ALL_GREENE_ENTRIES.map((e) => e.key));
    for (const entry of CREATIVE_STRATEGIES) {
      expect(entry.relatedKeys.length, `${entry.key} relatedKeys`).toBeGreaterThan(0);
      for (const k of entry.relatedKeys) {
        expect(allKeys.has(k), `${entry.key} → dangling relatedKey "${k}"`).toBe(
          true,
        );
      }
    }
  });
});
