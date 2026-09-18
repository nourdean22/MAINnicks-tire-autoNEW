/**
 * tests/brain/bge-rerank-score.test.ts — 2026-09-18.
 *
 * bge-rerank had been failing 100% in production, observed live in a recall-eval
 * run as:
 *   HF rerank 400: TextClassificationPipeline.__call__() missing 1 required
 *   positional argument: 'inputs'
 * so every rerank fell through to Cohere at roughly 5000x the per-rerank cost
 * ($0.0001/1000 vs $2/1000, per the module's own header) — the exact saving the
 * module exists to capture.
 *
 * TWO defects, and fixing only the first would have kept it broken:
 *   1. the PAYLOAD was the sentence-similarity shape, not the cross-encoder one
 *   2. the PARSER only inspected `data[0]` for a number or an object carrying
 *      `score`, so a NESTED `[[{label,score}]]` response returned null and the
 *      caller counted a perfectly good answer as a failed candidate
 *
 * These pin #2. #1 is pinned by the measured payload comment in the module and
 * cannot be unit-tested without hitting the paid endpoint.
 */
import { describe, it, expect } from "vitest";
import { extractRerankScore } from "@/lib/brain/bge-rerank";

describe("extractRerankScore survives every nesting HF actually emits", () => {
  it("a bare number", () => {
    expect(extractRerankScore(0.9963)).toBe(0.9963);
  });

  it("a flat array of numbers", () => {
    expect(extractRerankScore([0.9963, 0.1])).toBe(0.9963);
  });

  it("an array of objects carrying `score`", () => {
    expect(extractRerankScore([{ label: "LABEL_0", score: 0.9963 }])).toBe(0.9963);
  });

  it("★ THE REGRESSION: a NESTED array of objects", () => {
    // The shape the old parser could not read. It checked data[0] for a number
    // or an object with `score`; data[0] was an ARRAY, so it fell through to
    // `return null` and the candidate was recorded as FAILED. A payload-only
    // fix would have produced exactly the same 100% failure rate.
    expect(extractRerankScore([[{ label: "LABEL_0", score: 0.9963 }]])).toBe(0.9963);
  });

  it("`relevance_score` as the key, which some rerank endpoints use", () => {
    expect(extractRerankScore([{ relevance_score: 0.42 }])).toBe(0.42);
  });

  it("a bare object carrying `score`", () => {
    expect(extractRerankScore({ score: 0.5 })).toBe(0.5);
  });
});

describe("extractRerankScore refuses what it cannot read", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty array", []],
    ["empty object", {}],
    ["a string", "0.99"],
    ["an object with no score key", [{ label: "LABEL_0" }]],
  ])("returns null for %s", (_label, input) => {
    expect(extractRerankScore(input)).toBeNull();
  });

  it("★ CANARY: NaN and Infinity are NOT scores", () => {
    // Without the isFinite guards these pass `typeof x === "number"` and become
    // a candidate's rank. NaN sorts unpredictably and Infinity pins a row to the
    // top of the recall list forever — a silently poisoned ranking rather than a
    // visible failure, which is strictly worse than returning null.
    expect(extractRerankScore(Number.NaN)).toBeNull();
    expect(extractRerankScore([{ score: Number.NaN }])).toBeNull();
    expect(extractRerankScore(Number.POSITIVE_INFINITY)).toBeNull();
    expect(extractRerankScore([{ score: Number.POSITIVE_INFINITY }])).toBeNull();
  });

  it("CONTROL: a legitimate 0 is still a score, not a miss", () => {
    // The irrelevant passage in the live probe scored exactly 0.0000. If zero
    // were treated as falsy-and-therefore-absent, every correctly-rejected
    // candidate would be recorded as a FAILED call, and >50% failures make
    // _bgeRerank return null — the whole lane would disable itself precisely
    // when it was working.
    expect(extractRerankScore(0)).toBe(0);
    expect(extractRerankScore([{ score: 0 }])).toBe(0);
    expect(extractRerankScore([[{ label: "LABEL_0", score: 0 }]])).toBe(0);
  });
});
