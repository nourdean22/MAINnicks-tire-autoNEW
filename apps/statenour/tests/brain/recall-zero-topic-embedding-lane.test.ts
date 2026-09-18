/**
 * tests/brain/recall-zero-topic-embedding-lane.test.ts · 2026-09-18
 *
 * A turn whose words are all stopwords ("what about that one") derives ZERO
 * fast-topics. Recall then took a bare `topics.length === 0` branch and
 * returned getFallbackMemories() — top-N by CONFIDENCE, the query discarded.
 * The operator asks a follow-up and gets the brain's most-confident memories,
 * which have nothing to do with what they asked.
 *
 * That guard predates the Wave-81 `queryEmbedding` pass-through. The caller
 * (brain-context.ts) already hands in an embedding of the user's own message,
 * and with it TWO of the four lanes need no topics whatsoever:
 *
 *   semantic  getSemanticScores prefers precomputedEmbedding over queryText
 *   knn pool  getKnnPoolRows is pure vector
 *
 * and the two that do need topics degrade NEUTRALLY, not wrongly:
 *
 *   lexical   buildLexicalTsQuery([]) -> "" -> the lane returns []
 *   keyword   keywordScore(m, []) -> 0 for EVERY row -> cannot reorder anything
 *
 * So the fallback was discarding a working query. It now fires only when there
 * is no embedding EITHER — the one case where there is genuinely nothing to
 * search with.
 *
 * Imports the real predicates rather than re-stating them: a copy in the test
 * would keep passing while the source rotted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveFastTopics,
  shouldFallbackToConfidence,
  buildQueryText,
} from "@/lib/brain/contextual-recall";

const SRC = readFileSync(
  join(__dirname, "..", "..", "lib", "brain", "contextual-recall.ts"),
  "utf8",
);

/** A real embedding is 1536 floats; length is all these predicates read. */
const EMBEDDING = new Array(1536).fill(0.01);

/**
 * Short follow-ups of the kind that actually reach this path. Each is checked
 * below to genuinely derive zero topics — if the stopword list changes and one
 * starts producing topics, the positive control fails rather than this file
 * quietly testing nothing.
 */
const ZERO_TOPIC_TURNS = [
  "what about that one",
  "is it still like that",
  "why not",
  "and then what",
  "can you do that",
  "what do you think",
];

/**
 * Found by the positive control below, on its first run: "is it still the same"
 * derives exactly one topic, ["same"], because "same" is not in
 * FAST_TOPIC_STOPWORDS. That turn therefore skips the fallback for the WRONG
 * reason — it has a topic, but one that lexically matches any memory containing
 * the word "same". Left as a fixture here rather than fixed, because widening
 * the stopword list is a ranking change that belongs with a recall-eval run,
 * not with this guard. Recorded so the next reader knows it is known.
 */
const TOPIC_BUT_USELESS = "is it still the same";

describe("zero-topic turns · positive control", () => {
  it("every fixture really does derive zero topics (else this file tests nothing)", () => {
    const withTopics = ZERO_TOPIC_TURNS.filter((t) => deriveFastTopics([t]).length > 0);
    expect(
      withTopics,
      "these fixtures are no longer topic-free — pick new ones or this suite is vacuous",
    ).toEqual([]);
  });

  it("and the detector is not simply always-zero — a normal turn DOES derive topics", () => {
    // Without this, a broken deriveFastTopics would make the control above pass.
    expect(deriveFastTopics(["the tire inventory at the euclid shop"]).length).toBeGreaterThan(0);
  });

  it("documents the near-miss the control caught: one stopword gap yields a useless topic", () => {
    // Not a fix, a record — see TOPIC_BUT_USELESS above. If someone later adds
    // "same" to FAST_TOPIC_STOPWORDS this flips, and the comment should go too.
    expect(deriveFastTopics([TOPIC_BUT_USELESS])).toEqual(["same"]);
  });
});

describe("shouldFallbackToConfidence · the fallback is now about the QUERY, not the topics", () => {
  it("zero topics + a usable embedding: DO NOT fall back (the regression this fixes)", () => {
    for (const turn of ZERO_TOPIC_TURNS) {
      expect(
        shouldFallbackToConfidence(deriveFastTopics([turn]), EMBEDDING),
        `"${turn}" still discards its embedding and returns confidence-ranked memories`,
      ).toBe(false);
    }
  });

  it("zero topics + NO embedding: still falls back — nothing to search with", () => {
    expect(shouldFallbackToConfidence([], undefined)).toBe(true);
    expect(shouldFallbackToConfidence([], [])).toBe(true);
  });

  it("topics present: never falls back, embedding or not", () => {
    expect(shouldFallbackToConfidence(["tires"], undefined)).toBe(false);
    expect(shouldFallbackToConfidence(["tires"], EMBEDDING)).toBe(false);
  });
});

describe("buildQueryText · the empty string never reaches the reranker", () => {
  it("zero topics falls back to the operator's own last message", () => {
    // topics.join(", ") would be "" here, and "" flows on to rerank({ query })
    // and semanticSearch() — both would score against nothing.
    expect(buildQueryText([], ["earlier turn", "what about that one"])).toBe("what about that one");
  });

  it("topics present are still joined (unchanged behaviour)", () => {
    expect(buildQueryText(["tires", "euclid"], ["whatever"])).toBe("tires, euclid");
  });

  it("no topics and no messages is the only empty result", () => {
    expect(buildQueryText([], [])).toBe("");
  });

  it("caps the message so a pasted wall of text cannot become the rerank query", () => {
    expect(buildQueryText([], ["x".repeat(900)]).length).toBe(500);
  });
});

describe("the predicates are actually WIRED (a correct unused helper proves nothing)", () => {
  it("getContextualMemories calls both, and the bare topics-only guard is gone", () => {
    expect(SRC).toContain("shouldFallbackToConfidence(topics, opts.queryEmbedding)");
    expect(SRC).toContain("buildQueryText(topics, recentMessages)");
    // Two-sided: reverting to the old guard reintroduces this exact line, so
    // this assertion fails rather than passing on a mention elsewhere.
    expect(
      /if\s*\(\s*topics\.length === 0\s*\)\s*\{/.test(SRC),
      "the bare `if (topics.length === 0)` fallback guard is back — the embedding lanes are being discarded again",
    ).toBe(false);
  });

  it("the header line renders queryText, not an empty topics join", () => {
    // `for: ${topics.join(", ")}` put a bare "for: )" into the model's prompt.
    expect(SRC).not.toContain("for: ${topics.join");
  });
});

describe("buildQueryText · hot-path hardening (found in self-audit)", () => {
  it("a non-string message does not throw — a throw here reads as an EMPTY brain block", () => {
    // getContextualMemories runs under withTimeout(..., 3000, ""), so an
    // exception is indistinguishable from "recall found nothing".
    expect(() => buildQueryText([], [123 as unknown as string])).not.toThrow();
    expect(buildQueryText([], [123 as unknown as string])).toBe("123");
    expect(() => buildQueryText([], [null as unknown as string])).not.toThrow();
  });
});
