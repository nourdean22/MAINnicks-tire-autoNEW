/**
 * ReDoS PROBE -- 2026-09-10, self-review of PR #2267.
 *
 * `detectNamedSources` runs three regexes over EVERY assistant reply,
 * and `loadPriorRecommendations` runs them again over up to 60 stored
 * messages per recommendation turn. One of them nests a quantified
 * group inside another quantifier:
 *
 *   ((?:[A-Z][\w'&.-]*(?:\s+(?:of|the|...)\s+|\s+)){0,4}[A-Z][\w'&.-]*)
 *
 * That is the classic catastrophic-backtracking shape. On a hot path
 * that also processes stored EXTERNAL content (captured emails), a
 * pathological input would be a denial of service reachable by anyone
 * who can email the operator.
 *
 * These tests bound the runtime on adversarial inputs. They deliberately
 * assert against the REAL exported function rather than a copied regex:
 * a copy drifts, and a probe measuring a copy proves nothing about
 * production.
 */
import { describe, it, expect } from "vitest";
import { detectNamedSources } from "@/lib/ai/chat/named-source-claims";
import { checkNovelty } from "@/lib/ai/chat/recommendation-novelty";

/** Generous ceiling: this is a per-turn hot path, not a batch job. */
const BUDGET_MS = 400;

function timed(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

const ADVERSARIAL: Array<[string, string]> = [
  // Long run of capitalized tokens that never reaches a resource noun --
  // the worst case for the {0,4} prefix group.
  ["capitalized run, no noun", "Aa ".repeat(600) + "!"],
  // Same, but ending in a NEAR-miss so the engine backtracks the whole way.
  ["capitalized run, near-miss noun", "Aa ".repeat(500) + "channelx"],
  // Connector alternation, which multiplies the paths through the group.
  ["connector alternation", "A of A of A of A of ".repeat(200) + "!"],
  // A list title that opens a delimiter and never closes it.
  ["unclosed list title", "- **" + "A".repeat(8000)],
  // Punctuation-dense text inside the permitted character class.
  ["punctuation dense", "A.-'&".repeat(2000) + " channel"],
  // A very long single word.
  ["one huge token", "A".repeat(20000)],
];

describe("detectNamedSources is bounded on adversarial input", () => {
  for (const [name, text] of ADVERSARIAL) {
    it(`stays under ${BUDGET_MS}ms: ${name}`, () => {
      expect(timed(() => detectNamedSources(text))).toBeLessThan(BUDGET_MS);
    });
  }

  // CONTROL: an ordinary long reply must also be fast, and must still
  // actually FIND things -- a function that returned early on everything
  // would pass every timing assertion above while being useless.
  it("CONTROL - a realistic long reply is fast AND still detects", () => {
    const prose = "The pattern here is consistent and worth naming. ".repeat(150);
    expect(timed(() => detectNamedSources(prose))).toBeLessThan(BUDGET_MS);
    expect(detectNamedSources(prose)).toHaveLength(0);

    const withNames = prose + "\nTry the Daily Stoic podcast and the Huberman Lab channel.";
    const found = detectNamedSources(withNames).map((c) => c.name);
    expect(found).toContain("Daily Stoic");
    expect(found).toContain("Huberman Lab");
  });
});

describe("the novelty scan is bounded too", () => {
  // loadPriorRecommendations runs the same extractor over up to 60
  // stored messages, and those messages include captured external mail.
  it("scanning a large hostile message stays under budget", () => {
    const hostile = ADVERSARIAL.map(([, t]) => t).join("\n");
    expect(timed(() => checkNovelty(hostile, []))).toBeLessThan(BUDGET_MS);
  });
});
