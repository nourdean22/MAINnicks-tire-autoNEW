/**
 * contextual-greene-laws · candidate selection · 2026-07-28.
 *
 * Regression cover for a defect caught in review of PR #1139.
 *
 * The candidate set was chosen by sorting on a type-priority table and
 * taking `slice(0, 40)`. That is degenerate whenever one type outnumbers
 * the cap on its own: the corpus holds 48 `law` rows at priority 0, so the
 * sort placed 48 laws first and the slice kept 40 of them. Every other
 * type — mentorship roles, dark traits, principles, and all nine Book V
 * creative strategies — was deterministically cut before the model ever
 * saw the list.
 *
 * The subtle part is that adding `creative_strategy: 3` to the priority
 * table LOOKED like the fix and changed nothing: a lower priority number
 * cannot help when the top bucket alone overflows the cap. These tests
 * assert representation, not ordering, so a future edit that reintroduces
 * a plain sort-and-slice fails here.
 */

import { describe, expect, it } from "vitest";

import { selectCandidates, CANDIDATE_CAP } from "@/lib/ai/contextual-greene-laws";

const row = (type: string, i: number) => ({
  key: `${type}_${i}`,
  metadata: { type } as Record<string, unknown>,
});

/** Shaped like the real corpus: laws alone exceed the cap. */
const realisticCorpus = [
  ...Array.from({ length: 48 }, (_, i) => row("law", i)),
  ...Array.from({ length: 41 }, (_, i) => row("strategy", i)),
  ...Array.from({ length: 10 }, (_, i) => row("fearless_law", i)),
  ...Array.from({ length: 9 }, (_, i) => row("creative_strategy", i)),
  ...Array.from({ length: 5 }, (_, i) => row("mentorship_role", i)),
  ...Array.from({ length: 3 }, (_, i) => row("phase", i)),
  ...Array.from({ length: 13 }, (_, i) => row("dark_trait", i)),
  ...Array.from({ length: 6 }, (_, i) => row("principle", i)),
  ...Array.from({ length: 18 }, (_, i) => row("seducer_type", i)),
];

const typesIn = (rows: Array<{ metadata: Record<string, unknown> }>) =>
  new Set(rows.map((r) => String(r.metadata.type)));

describe("selectCandidates", () => {
  it("returns everything when under the cap", () => {
    const small = realisticCorpus.slice(0, 10);
    expect(selectCandidates(small, CANDIDATE_CAP)).toHaveLength(10);
  });

  it("respects the cap", () => {
    expect(selectCandidates(realisticCorpus, CANDIDATE_CAP)).toHaveLength(CANDIDATE_CAP);
  });

  it("reaches creative strategies even though laws alone exceed the cap", () => {
    // The exact regression: with sort-and-slice this was 0.
    const picked = selectCandidates(realisticCorpus, CANDIDATE_CAP);
    const creative = picked.filter((r) => r.metadata.type === "creative_strategy");
    expect(creative.length).toBeGreaterThan(0);
  });

  it("represents every type present in the corpus", () => {
    const picked = selectCandidates(realisticCorpus, CANDIDATE_CAP);
    expect(typesIn(picked)).toEqual(typesIn(realisticCorpus));
  });

  it("still favors higher-priority types in the remainder", () => {
    // Round-robin gives every type a floor; priority decides who gets the
    // leftover slots in the final partial pass.
    const picked = selectCandidates(realisticCorpus, CANDIDATE_CAP);
    const count = (t: string) => picked.filter((r) => r.metadata.type === t).length;
    expect(count("law")).toBeGreaterThanOrEqual(count("seducer_type"));
  });

  it("never returns a duplicate row", () => {
    const picked = selectCandidates(realisticCorpus, CANDIDATE_CAP);
    expect(new Set(picked.map((r) => r.key)).size).toBe(picked.length);
  });

  it("terminates when every bucket is exhausted before the cap", () => {
    // Guards the round-robin loop against spinning when total < cap but
    // the early-return was bypassed.
    const tiny = [row("law", 0), row("phase", 0)];
    expect(selectCandidates(tiny, 40)).toHaveLength(2);
  });

  it("handles rows with no type by bucketing them as principle", () => {
    const untyped = Array.from({ length: 50 }, (_, i) => ({
      key: `u_${i}`,
      metadata: {} as Record<string, unknown>,
    }));
    const picked = selectCandidates(untyped, CANDIDATE_CAP);
    expect(picked).toHaveLength(CANDIDATE_CAP);
  });
});
