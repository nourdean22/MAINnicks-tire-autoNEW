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
      { total: 250, classified: 250, resolved: 200, unresolved: 50, malformed: 0 },
    ]);
    await expect(countContradictionsByStatus(90)).resolves.toEqual({
      total: 250,
      classified: 250,
      resolved: 200,
      unresolved: 50,
      malformed: 0,
    });
  });

  it("sends NO row cap — that was the whole defect", async () => {
    mockQueryRaw.mockResolvedValue([
      { total: 0, classified: 0, resolved: 0, unresolved: 0, malformed: 0 },
    ]);
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
    mockQueryRaw.mockResolvedValue([
      { total: 0, classified: 0, resolved: 0, unresolved: 0, malformed: 0 },
    ]);
    await countContradictionsByStatus(90);
    const sql = String(mockQueryRaw.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain("IS JSON OBJECT");
    expect(sql).toMatch(/CASE\s+WHEN\s+content\s+IS\s+JSON\s+OBJECT/i);
  });

  it("treats a missing status as unresolved, matching the JS it replaced", async () => {
    // The JS predicate was `!c.status || c.status === "unresolved"`. The SQL
    // is COALESCE(...,'unresolved'). Verified equal against the live database
    // on six inputs before shipping; this pins the SQL half.
    mockQueryRaw.mockResolvedValue([
      { total: 0, classified: 0, resolved: 0, unresolved: 0, malformed: 0 },
    ]);
    await countContradictionsByStatus(90);
    const sql = String(mockQueryRaw.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain("COALESCE(j->>'status', 'unresolved')");
  });

  it("survives an empty result set without throwing", async () => {
    mockQueryRaw.mockResolvedValue([]);
    await expect(countContradictionsByStatus(90)).resolves.toEqual({
      total: 0,
      classified: 0,
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
 * WHAT THIS FILE CANNOT PROVE, stated plainly.
 *
 * From review (#2092): the block that used to sit here listed six inputs with
 * their expected labels and then TALLIED THE EXPECTATIONS. It executed nothing.
 * Reversing the SQL's resolved/unresolved comparison would have left it green.
 * It was an oracle agreeing with itself — a test that cannot fail, which is the
 * silent-instrument defect this whole wave was written to remove, committed
 * inside the canary meant to guard against it. It is deleted rather than
 * repaired, because a test that cannot fail is worse than no test: it buys
 * confidence it has not earned.
 *
 * The SQL classifier runs in Postgres, so no unit test in this suite can
 * execute it. The assertions above are therefore REGRESSION DETECTORS for the
 * specific predicates (no LIMIT, the IS JSON guard, the COALESCE default) and
 * nothing more — they would not catch a reversed comparison either, and they
 * do not claim to.
 *
 * The equivalence between the SQL and the JS it replaced was verified BY HAND
 * against the live PG17 database before the query shipped, on six inputs:
 *
 *   {"status":"resolved"}    -> resolved     {"a":1}            -> unresolved
 *   {"status":"unresolved"}  -> unresolved   not json at all    -> malformed
 *   {"status":"dismissed"}   -> resolved     [1,2,3]            -> malformed
 *
 *   total 6 · classified 4 · resolved 2 · unresolved 2 · malformed 2
 *
 * Re-run against production after `classified` was added (it was NOT re-run
 * when that column first went in, which is the gap this note closes): both
 * invariants hold on the real engine — classified = resolved + unresolved,
 * and classified + malformed = total.
 *
 * That is a receipt, not a gate. Making it a gate needs a database-backed
 * harness this suite does not have; if one is ever added, this is the first
 * expression that should move into it.
 */

/**
 * The partition invariant, which CAN be tested here because the consumer does
 * the arithmetic in TypeScript.
 *
 * Also from review: `total` counts malformed rows while `resolved` and
 * `unresolved` do not, so `resolved / total` charged the maturity score for
 * every unparseable row as though it were an open contradiction — and that row
 * showed up in neither counter. `classified` is the denominator now.
 */
describe("countContradictionsByStatus · the partition holds", () => {
  beforeEach(() => mockQueryRaw.mockReset());

  it("classified excludes malformed, and the two buckets sum to it", async () => {
    mockQueryRaw.mockResolvedValue([
      { total: 10, classified: 8, resolved: 5, unresolved: 3, malformed: 2 },
    ]);
    const r = await countContradictionsByStatus(90);
    expect(r.resolved + r.unresolved).toBe(r.classified);
    expect(r.classified + r.malformed).toBe(r.total);
  });

  it("PLANTED POSITIVE · the invariant is checkable, i.e. it can be violated", () => {
    // Guards against the assertion above being vacuous: prove the shape it
    // rejects is expressible. A row where malformed is silently folded into
    // classified breaks the sum.
    const bad = { total: 10, classified: 10, resolved: 5, unresolved: 3, malformed: 2 };
    expect(bad.resolved + bad.unresolved).not.toBe(bad.classified);
  });

  it("selects a classified count separate from the row count", async () => {
    mockQueryRaw.mockResolvedValue([
      { total: 0, classified: 0, resolved: 0, unresolved: 0, malformed: 0 },
    ]);
    await countContradictionsByStatus(90);
    const sql = String(mockQueryRaw.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain("FILTER (WHERE j IS NOT NULL)");
    expect(sql).toContain("AS classified");
  });
});

/**
 * 2026-09-02 self-audit · `countUnresolved` carried the same bias.
 *
 * The commit that introduced `countContradictionsByStatus` described this in
 * its own message -- "countUnresolved goes through the same path, so it
 * carried the bias too" -- and then fixed only brain-domain's consumer. Three
 * others kept reading capped numbers:
 *
 *   · lib/brain/cross-system-nudge.ts:133   (nudge triggering)
 *   · lib/services/contradictions.ts:119    (unresolvedLast14)
 *   · lib/ultron/narrator.ts:473            (escalates at >= 2 open)
 *
 * Describing a defect is not fixing it. All four now share one uncapped query.
 */
describe("countUnresolved · shares the uncapped count", () => {
  beforeEach(() => mockQueryRaw.mockReset());

  it("returns the unresolved count from the same query, not a capped list", async () => {
    const { countUnresolved } = await import("@/lib/brain/contradiction-surfacer");
    mockQueryRaw.mockResolvedValue([
      { total: 250, classified: 250, resolved: 200, unresolved: 50, malformed: 0 },
    ]);
    // 50, not 40 -- a capped list could not have produced this.
    expect(await countUnresolved(14)).toBe(50);
    const sql = String(mockQueryRaw.mock.calls[0]?.[0] ?? "");
    expect(sql).not.toMatch(/\bLIMIT\b/i);
  });

  it("passes its own window through rather than the 90-day default", async () => {
    const { countUnresolved } = await import("@/lib/brain/contradiction-surfacer");
    mockQueryRaw.mockResolvedValue([
      { total: 0, classified: 0, resolved: 0, unresolved: 0, malformed: 0 },
    ]);
    await countUnresolved(14);
    // The 14-day callers must not silently start reading 90 days.
    const params = mockQueryRaw.mock.calls[0] ?? [];
    const since = params.find((p: unknown) => p instanceof Date) as Date | undefined;
    expect(since).toBeInstanceOf(Date);
    const daysAgo = (Date.now() - (since as Date).getTime()) / 86_400_000;
    expect(daysAgo).toBeGreaterThan(13);
    expect(daysAgo).toBeLessThan(15);
  });

  it("PLANTED POSITIVE · malformed rows are not counted as unresolved", async () => {
    mockQueryRaw.mockResolvedValue([
      { total: 12, classified: 10, resolved: 7, unresolved: 3, malformed: 2 },
    ]);
    const { countUnresolved } = await import("@/lib/brain/contradiction-surfacer");
    expect(await countUnresolved(14)).toBe(3);
  });
});

/**
 * 2026-09-02 self-audit, third consumer · `listContradictions`.
 *
 * `summary.total` and `summary.unresolved` were derived from `items`, which
 * loadRecentContradictions caps at 40 BEFORE filtering by status. A window
 * holding 250 contradictions therefore reported a total of 40 -- the SAMPLE
 * SIZE presented as the population, which is the same wrong-population defect
 * the maturity rollup was fixed for one layer up, in a service the earlier fix
 * did not look at.
 *
 * The list stays capped (40 rows is a reasonable page). The summary does not.
 */
describe("listContradictions · the summary counts the window, not the page", () => {
  beforeEach(() => vi.resetModules());

  it("reports the WINDOW total even when the item list is capped", async () => {
    vi.doMock("@/lib/brain/contradiction-surfacer", () => ({
      loadAllContradictions: vi.fn().mockResolvedValue(
        Array.from({ length: 40 }, (_, i) => ({
          key: `c${i}`, new_excerpt: "", old_excerpt: "", days_apart: 1,
          signal: "x", similarity: 0.9, status: "unresolved",
          surfaced_at: "2026-09-01", createdAt: "2026-09-01",
        })),
      ),
      loadRecentContradictions: vi.fn().mockResolvedValue([]),
      countUnresolved: vi.fn().mockResolvedValue(50),
      countContradictionsByStatus: vi.fn().mockResolvedValue({
        total: 250, classified: 250, resolved: 200, unresolved: 50, malformed: 0,
      }),
    }));
    const { listContradictions } = await import("@/lib/services/contradictions");
    const view = await listContradictions({ days: 90, includeResolved: true });

    expect(view.items).toHaveLength(40); // the page
    expect(view.summary.total).toBe(250); // the population
    expect(view.summary.unresolved).toBe(50);
    // And the gap is DISCLOSED rather than silently absorbed.
    expect(view.summary.itemsTruncated).toBe(true);
  });

  it("PLANTED POSITIVE · an untruncated page is not flagged as truncated", async () => {
    // Without this, hardcoding itemsTruncated:true would pass the test above.
    vi.doMock("@/lib/brain/contradiction-surfacer", () => ({
      loadAllContradictions: vi.fn().mockResolvedValue([
        { key: "c0", new_excerpt: "", old_excerpt: "", days_apart: 1, signal: "x",
          similarity: 0.9, status: "unresolved", surfaced_at: "2026-09-01",
          createdAt: "2026-09-01" },
      ]),
      loadRecentContradictions: vi.fn().mockResolvedValue([]),
      countUnresolved: vi.fn().mockResolvedValue(1),
      countContradictionsByStatus: vi.fn().mockResolvedValue({
        total: 1, classified: 1, resolved: 0, unresolved: 1, malformed: 0,
      }),
    }));
    const { listContradictions } = await import("@/lib/services/contradictions");
    const view = await listContradictions({ days: 90, includeResolved: true });

    expect(view.summary.total).toBe(1);
    expect(view.summary.itemsTruncated).toBe(false);
  });
});
