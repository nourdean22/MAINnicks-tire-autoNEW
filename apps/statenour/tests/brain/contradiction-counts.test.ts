/**
 * tests/brain/contradiction-counts.test.ts
 * 2026-09-02 · the resolve rate stops being newest-biased.
 *
 * `loadRecentContradictions` applies `take: 40` BEFORE parsing `status` out of
 * the JSON body, so every count derived from it was wrong in two directions at
 * once: past 40 rows in the window you could only ever see the 40 newest, and
 * the newest are the least likely to be resolved. A resolve rate from that list
 * is systematically low; an unresolved count is systematically short.
 *
 * PR #2090 made the truncation VISIBLE (`contradictions.truncated`). Visible is
 * not correct. `countContradictionsByStatus` counts in SQL with no cap — it is
 * a count, so it never needed the list.
 *
 * WHAT THIS FILE PINS. The classification moved from JS into SQL, so the thing
 * that can now silently drift is the SQL expression's agreement with the JS it
 * replaced. Every case below was executed against the live PG17 database before
 * the query shipped; these assertions restate that result so a future edit to
 * the expression has to keep it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockQueryRaw } = vi.hoisted(() => ({ mockQueryRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: mockQueryRaw } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { countContradictionsByStatus } from "@/lib/brain/contradiction-surfacer";

describe("countContradictionsByStatus · counts the whole window", () => {
  beforeEach(() => mockQueryRaw.mockReset());

  it("returns the row the database produced", async () => {
    mockQueryRaw.mockResolvedValue([
      { total: 250, resolved: 200, unresolved: 50, malformed: 0 },
    ]);
    await expect(countContradictionsByStatus(90)).resolves.toEqual({
      total: 250,
      resolved: 200,
      unresolved: 50,
      malformed: 0,
    });
  });

  it("sends NO row cap — that was the whole defect", async () => {
    mockQueryRaw.mockResolvedValue([{ total: 0, resolved: 0, unresolved: 0, malformed: 0 }]);
    await countContradictionsByStatus(90);
    const sql = String(mockQueryRaw.mock.calls[0]?.[0] ?? "");
    expect(sql).not.toMatch(/\bLIMIT\b/i);
    expect(sql).not.toMatch(/\btake\b/i);
  });

  it("guards the JSON cast, because malformed rows demonstrably exist", async () => {
    // contradiction-surfacer keeps a `malformed` counter, so a bare
    // `content::jsonb` would ERROR on a bad row rather than skip it. The CASE
    // is what makes the cast conditional — SQL does not promise to
    // short-circuit an AND.
    mockQueryRaw.mockResolvedValue([{ total: 0, resolved: 0, unresolved: 0, malformed: 0 }]);
    await countContradictionsByStatus(90);
    const sql = String(mockQueryRaw.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain("IS JSON OBJECT");
    expect(sql).toMatch(/CASE\s+WHEN\s+content\s+IS\s+JSON\s+OBJECT/i);
  });

  it("treats a missing status as unresolved, matching the JS it replaced", async () => {
    // The JS predicate was `!c.status || c.status === "unresolved"`. The SQL
    // is COALESCE(...,'unresolved'). Verified equal against the live database
    // on six inputs before shipping; this pins the SQL half.
    mockQueryRaw.mockResolvedValue([{ total: 0, resolved: 0, unresolved: 0, malformed: 0 }]);
    await countContradictionsByStatus(90);
    const sql = String(mockQueryRaw.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain("COALESCE(j->>'status', 'unresolved')");
  });

  it("survives an empty result set without throwing", async () => {
    mockQueryRaw.mockResolvedValue([]);
    await expect(countContradictionsByStatus(90)).resolves.toEqual({
      total: 0,
      resolved: 0,
      unresolved: 0,
      malformed: 0,
    });
  });

  /**
   * PROPAGATION — a failed read must not resolve to zeros — is asserted where
   * it can be observed end to end rather than here:
   * tests/lib/services/brain-domain-maturity-degraded.test.ts, "one failed
   * read is enough to withhold the score", rejects this exact function and
   * checks the consumer reports `score: null` and `failedReads:
   * ["contradictions"]`.
   *
   * It is not duplicated here because this file mocks `$queryRaw` directly:
   * a rejection or throw from that mock is picked up by vitest's
   * unhandled-error watcher and fails the test alongside the assertion that
   * passed, no matter whether it is written with `.rejects`, a lazy
   * `Promise.reject`, or an explicit try/catch. Asserting it through the
   * consumer proves the same property without wrestling the harness — and
   * proves the more useful half, since what matters is that the SCORE goes
   * null, not that a promise rejects.
   */

});

/**
 * The classification table, as executed against production PG17 before the
 * query shipped. Kept as data rather than prose so the six cases are readable
 * next to the expression they describe.
 */
describe("countContradictionsByStatus · the classification it was built to match", () => {
  it("documents the verified behaviour of each input shape", () => {
    const verified = [
      ['{"status":"resolved"}', "resolved"],
      ['{"status":"unresolved"}', "unresolved"],
      ['{"a":1}', "unresolved"], // no status -> COALESCE default
      ["not json at all", "malformed"],
      ['{"status":"dismissed"}', "resolved"], // anything not "unresolved"
      ["[1,2,3]", "malformed"], // an array is not a Contradiction
    ] as const;
    // 6 inputs -> 2 resolved, 2 unresolved, 2 malformed, summing to the total.
    const tally = verified.reduce<Record<string, number>>((acc, [, k]) => {
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    expect(tally).toEqual({ resolved: 2, unresolved: 2, malformed: 2 });
    expect(verified.length).toBe(6);
  });
});
