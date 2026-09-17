/**
 * Canaries for lane tool-call attribution.
 *
 * WHY THIS FILE EXISTS. Three lanes in `alternate-paths.ts` pass `tools` to the
 * model, but only pre-flush captured `r.toolCalls`. Regen and self-consistency
 * threw the receipts away and declared themselves BLIND, so `tool.chosen`
 * under-reported every turn they handled.
 *
 * The obvious fix — record every generation's calls — would have been WORSE
 * than the bug. Regen generates up to twice and self-consistency samples three
 * times; exactly one generation becomes the reply. A union would report tools
 * that never reached the operator, and an over-count is harder to notice than a
 * zero because it looks like richer data.
 */
import { describe, it, expect } from "vitest";
import { attributeWinningSample } from "@/lib/services/chat/lane-sample-attribution";

const SAMPLES = [
  { text: "first draft", calls: ["searchMemories"] },
  { text: "second draft", calls: ["githubRecentCommits", "getTasks"] },
  { text: "third draft", calls: [] },
];

describe("attributeWinningSample", () => {
  it("attributes only the winning generation's calls", () => {
    const a = attributeWinningSample({
      samples: SAMPLES,
      winningText: "second draft",
      alreadyAvailable: false,
    });
    expect(a?.toolNames).toEqual(["githubRecentCommits", "getTasks"]);
    expect(a?.receiptsAvailable).toBe(true);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The failure mode that would look like success. If attribution ever
  // becomes a union, this test catches it: `searchMemories` belongs to a
  // losing draft and must never appear.
  it("CANARY — never unions calls across losing generations", () => {
    const a = attributeWinningSample({
      samples: SAMPLES,
      winningText: "second draft",
      alreadyAvailable: false,
    });
    expect(a?.toolNames).not.toContain("searchMemories");
    expect(a?.toolNames.length).toBe(2);
  });

  it("reports an EMPTY receipt when the winner called nothing — that is a finding", () => {
    const a = attributeWinningSample({
      samples: SAMPLES,
      winningText: "third draft",
      alreadyAvailable: false,
    });
    // Not null: the lane SAW the generation and it called nothing. That is
    // "offered and declined", which is exactly what the numerator is for.
    expect(a).not.toBeNull();
    expect(a?.toolNames).toEqual([]);
    expect(a?.receiptsAvailable).toBe(true);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // A synthesised answer matches no sample. Staying blind is correct; the
  // tempting "closest match" would reintroduce the guess.
  it("CANARY — stays BLIND when no sample text is the winner", () => {
    expect(
      attributeWinningSample({
        samples: SAMPLES,
        winningText: "a synthesised answer nobody generated",
        alreadyAvailable: false,
      }),
    ).toBeNull();
  });

  it("does not override a lane that already captured its own receipts", () => {
    expect(
      attributeWinningSample({
        samples: SAMPLES,
        winningText: "second draft",
        alreadyAvailable: true,
      }),
    ).toBeNull();
  });

  it("stays blind when the lane recorded no samples at all", () => {
    expect(
      attributeWinningSample({ samples: [], winningText: "x", alreadyAvailable: false }),
    ).toBeNull();
  });

  it("returns a copy, so a caller cannot mutate the recorded sample", () => {
    const a = attributeWinningSample({
      samples: SAMPLES,
      winningText: "second draft",
      alreadyAvailable: false,
    });
    a?.toolNames.push("injected");
    expect(SAMPLES[1].calls).toEqual(["githubRecentCommits", "getTasks"]);
  });
});
