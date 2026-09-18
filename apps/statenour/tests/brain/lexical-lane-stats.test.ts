/**
 * tests/brain/lexical-lane-stats.test.ts — 2026-09-18.
 *
 * `getLexicalMatches` returns `[]` for FOUR different things and no caller can
 * tell them apart: no query built · ran and matched nothing · the 900ms
 * statement_timeout dropped the lane · some other failure. Only the third is a
 * designed trade-off, and it was a bare console.warn — so its RATE was invisible
 * in production.
 *
 * That matters because the trade-off was accepted ON a measurement (2026-08-27:
 * "10 of 28 corpus queries, contributing exactly ONE lexical hit") and nothing
 * re-checked it as brain_memories grew. Measured 2026-09-18 on a sequential
 * unloaded probe: 9 of 25 over budget (36%) — unchanged. The point is that
 * nobody would have known either way.
 *
 * ⚠ THE FIRST VERSION OF THIS FILE WAS ITSELF THE DEFECT. computeLexicalSkipRate
 * originally read module state, so it could not be driven without a database;
 * the test therefore computed the arithmetic on its own local objects and
 * asserted that equalled itself. It would have passed with the function
 * DELETED. Making the predicate pure is what made a real test possible.
 *
 * The lane's DB-touching behaviour is covered by recall-budget-canaries.test.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  lexicalLaneStats,
  resetLexicalLaneStats,
  lexicalSkipRate,
  computeLexicalSkipRate,
  type LexicalLaneStats,
} from "@/lib/brain/contextual-recall";

const stats = (s: Partial<LexicalLaneStats>): LexicalLaneStats => ({
  noQuery: 0,
  ok: 0,
  skippedTimeout: 0,
  failedOther: 0,
  ...s,
});

describe("the counters decompose the four kinds of empty", () => {
  beforeEach(() => resetLexicalLaneStats());

  it("start at zero on every axis", () => {
    expect(lexicalLaneStats()).toEqual(stats({}));
  });

  it("★ an UNATTEMPTED lane reports null, never 0%", () => {
    // The failure this replaces is an unknown rendering as a healthy number.
    // A fresh process has attempted nothing; "0% skipped" would be a confident
    // lie, and it is exactly the silent-instrument shape.
    expect(lexicalSkipRate()).toBeNull();
  });

  it("lexicalLaneStats returns a snapshot, not a live reference", () => {
    // A caller holding the internal object would watch it mutate underneath
    // them and could log one turn's numbers against another turn's label.
    const a = lexicalLaneStats();
    a.ok = 999;
    expect(lexicalLaneStats().ok).toBe(0);
  });
});

describe("computeLexicalSkipRate · the denominator is the load-bearing decision", () => {
  it("★ CANARY: noQuery must NOT enter the denominator", () => {
    // A turn that produced no search terms never attempted the lane. Counting
    // it drives the rate toward zero exactly when topic extraction is failing —
    // the lane would look healthiest when the pipeline is sickest.
    const r = computeLexicalSkipRate(stats({ noQuery: 100, ok: 1, skippedTimeout: 1 }));
    expect(r).toBe(0.5);
    // If noQuery were included this would be 1/102 ≈ 0.0098 — a half-dead lane
    // reporting 1%. Asserting the WRONG value is not produced, not merely that
    // the right one is.
    expect(r).not.toBeCloseTo(0.0098, 3);
  });

  it("★ CANARY: a genuine zero-row result is `ok`, never a skip", () => {
    // Conflating "ran, found nothing" with "dropped the lane" is the original
    // defect. ok is incremented on a resolved query regardless of row count.
    expect(computeLexicalSkipRate(stats({ ok: 10 }))).toBe(0);
  });

  it("returns null when nothing was attempted, even with noQuery traffic", () => {
    expect(computeLexicalSkipRate(stats({ noQuery: 50 }))).toBeNull();
  });

  it("counts failedOther as attempted — a broken lane is not an absent one", () => {
    // failedOther belongs in the denominator but not the numerator: the query
    // WAS attempted, it just did not fail via the timeout path.
    expect(computeLexicalSkipRate(stats({ ok: 1, failedOther: 1 }))).toBe(0);
    expect(computeLexicalSkipRate(stats({ skippedTimeout: 1, failedOther: 1 }))).toBe(0.5);
  });

  it("an all-skipped lane reports 1, not null", () => {
    expect(computeLexicalSkipRate(stats({ skippedTimeout: 7 }))).toBe(1);
  });

  it("CONTROL: reproduces the measured 2026-09-18 figure", () => {
    // 9 of 25 over budget. Ties the arithmetic to a real observation, so the
    // denominator rule is anchored to something outside its own definition.
    const r = computeLexicalSkipRate(stats({ ok: 16, skippedTimeout: 9 }));
    expect(r).not.toBeNull();
    expect(Math.round((r as number) * 100)).toBe(36);
  });
});
