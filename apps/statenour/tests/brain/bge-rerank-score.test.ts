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
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  extractRerankScore,
  noteBgeOutcome,
  resetBgeBreaker,
  bgeBreakerState,
  isBgeRerankAvailable,
} from "@/lib/brain/bge-rerank";

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

/**
 * The circuit breaker. isBgeRerankAvailable() was `Boolean(process.env.HF_API_KEY)`,
 * so a key that is revoked, invalid, or OUT OF CREDITS (402, observed live
 * 2026-09-18) read as AVAILABLE forever — and rerank.ts would fire one doomed
 * request PER CANDIDATE (25 on the observed recall path) before falling back to
 * Cohere, on every chat turn, indefinitely.
 */
describe("bge circuit breaker: a present key is not a working backend", () => {
  const KEY = "HF_API_KEY";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
    process.env[KEY] = "test-key";
    resetBgeBreaker();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
    resetBgeBreaker();
  });

  const T0 = 1_000_000;

  it("CONTROL: with a key and no failures, the backend is available", () => {
    // Without this a breaker stuck permanently open would pass every test below.
    expect(isBgeRerankAvailable(T0)).toBe(true);
  });

  it("one total failure does NOT trip it — a single blip is not an outage", () => {
    noteBgeOutcome("total-failure", T0);
    expect(isBgeRerankAvailable(T0)).toBe(true);
    expect(bgeBreakerState().consecutiveTotalFailures).toBe(1);
  });

  it("★ two consecutive total failures go cold", () => {
    noteBgeOutcome("total-failure", T0);
    noteBgeOutcome("total-failure", T0);
    expect(isBgeRerankAvailable(T0)).toBe(false);
  });

  it("★ and it comes BACK after the cooldown — cold is not dead", () => {
    // A breaker that never recovers is just a permanent outage with extra steps.
    noteBgeOutcome("total-failure", T0);
    noteBgeOutcome("total-failure", T0);
    expect(isBgeRerankAvailable(T0 + 9 * 60_000)).toBe(false);
    expect(isBgeRerankAvailable(T0 + 11 * 60_000)).toBe(true);
  });

  it("a success resets the streak, so failures must be CONSECUTIVE", () => {
    noteBgeOutcome("total-failure", T0);
    noteBgeOutcome("success", T0);
    noteBgeOutcome("total-failure", T0);
    expect(isBgeRerankAvailable(T0)).toBe(true);
    expect(bgeBreakerState().consecutiveTotalFailures).toBe(1);
  });

  it("a success while COLD clears the cooldown immediately", () => {
    noteBgeOutcome("total-failure", T0);
    noteBgeOutcome("total-failure", T0);
    expect(isBgeRerankAvailable(T0)).toBe(false);
    noteBgeOutcome("success", T0);
    expect(isBgeRerankAvailable(T0)).toBe(true);
    expect(bgeBreakerState().coldUntilMs).toBe(0);
  });

  it("no key means unavailable regardless of breaker state", () => {
    delete process.env[KEY];
    expect(isBgeRerankAvailable(T0)).toBe(false);
  });
});
