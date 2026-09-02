/**
 * The wisdom feed is bounded, and it never reports the page as the corpus.
 *
 * THE DEFECT (2026-09-02 self-audit, #7). `buildWisdomFeed` ran
 * `findMany` with no `take` at all: every wisdom row (~991 at the time)
 * with full `content` (2000 chars each by the `updateWisdom` cap), and
 * the wisdom tab refetched all of it on any `brain` bus event.
 *
 * THE TRAP IN FIXING IT. `total` used to be `entries.length`, and the
 * tab's "all (N)" chip and "showing X of Y" both read it. Adding a
 * `take` without splitting the readings would have produced a page that
 * reports a truncated count as the size of the corpus — a quieter lie
 * than the one being fixed. So `total`/`totalRecalls` now come from a
 * DB aggregate while `loaded`/`groupings` describe the page, and the
 * invariant the chips depend on is asserted below:
 *
 *     sum(groupings.origin) === loaded === entries.length
 *
 * Also covers defect #5: the origin on each entry comes from the shared
 * resolver, so `metadata.origin` wins and the key prefixes it did not
 * previously know (buffett/gates/musk/greene) now resolve here too.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findMany: vi.fn(), aggregate: vi.fn() },
  },
}));

import { buildWisdomFeed, WISDOM_FEED_LIMIT } from "@/lib/services/brain-wisdom";
import { prisma } from "@/lib/prisma";

const findMany = prisma.brainMemory.findMany as unknown as ReturnType<typeof vi.fn>;
const aggregate = prisma.brainMemory.aggregate as unknown as ReturnType<typeof vi.fn>;

function dbRow(
  id: string,
  over: Partial<{ key: string; metadata: unknown; seenCount: number; confidence: number }> = {},
) {
  return {
    id,
    key: over.key ?? `wisdom_distilled_${id}`,
    content: `principle ${id}`,
    confidence: over.confidence ?? 0.8,
    seenCount: over.seenCount ?? 3,
    source: "distiller",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastSeen: new Date("2026-08-01T00:00:00Z"),
    metadata: over.metadata ?? null,
  };
}

/** The corpus-wide reading, independent of how many rows the page took. */
function agg(count: number, recalls: number) {
  return { _count: { _all: count }, _sum: { seenCount: recalls } };
}

beforeEach(() => {
  findMany.mockReset();
  aggregate.mockReset();
});

describe("buildWisdomFeed · the query is bounded", () => {
  it("passes a take to findMany", async () => {
    aggregate.mockResolvedValueOnce(agg(0, 0));
    findMany.mockResolvedValueOnce([]);
    await buildWisdomFeed();
    expect(findMany.mock.calls[0][0].take).toBe(WISDOM_FEED_LIMIT);
  });

  it("honours an explicit limit", async () => {
    aggregate.mockResolvedValueOnce(agg(0, 0));
    findMany.mockResolvedValueOnce([]);
    await buildWisdomFeed(25);
    expect(findMany.mock.calls[0][0].take).toBe(25);
  });

  it("keeps the ceiling above the corpus so nothing is hidden today", () => {
    // The ceiling is a ceiling, not a page size: `lib/trpc/routers/brain.ts`
    // calls this with no input and the tab has no pager, so a limit that
    // bit would strand rows the operator cannot reach. ~991 rows live.
    expect(WISDOM_FEED_LIMIT).toBeGreaterThan(991);
  });
});

describe("buildWisdomFeed · corpus counts vs page counts", () => {
  it("reports the corpus total and recalls from the aggregate, not the page", async () => {
    aggregate.mockResolvedValueOnce(agg(5, 400));
    findMany.mockResolvedValueOnce([dbRow("a"), dbRow("b")]);

    const view = await buildWisdomFeed(2);
    expect(view.total).toBe(5);
    expect(view.loaded).toBe(2);
    expect(view.truncated).toBe(true);
    // Pre-fix this summed `entries`, so a truncated page under-reported
    // lifetime recalls without saying so.
    expect(view.totalRecalls).toBe(400);
  });

  it("is not truncated when the page covers the corpus", async () => {
    aggregate.mockResolvedValueOnce(agg(2, 6));
    findMany.mockResolvedValueOnce([dbRow("a"), dbRow("b")]);

    const view = await buildWisdomFeed(500);
    expect(view.total).toBe(2);
    expect(view.loaded).toBe(2);
    expect(view.truncated).toBe(false);
  });

  it("survives an empty corpus without an aggregate null blowing up", async () => {
    aggregate.mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { seenCount: null } });
    findMany.mockResolvedValueOnce([]);

    const view = await buildWisdomFeed();
    expect(view.total).toBe(0);
    expect(view.totalRecalls).toBe(0);
    expect(view.entries).toEqual([]);
  });
});

describe("chip consistency · the invariant the wisdom tab renders", () => {
  it("origin groupings sum to loaded, which equals entries.length", async () => {
    aggregate.mockResolvedValueOnce(agg(99, 12));
    findMany.mockResolvedValueOnce([
      dbRow("a", { key: "wisdom_jobs_1" }),
      dbRow("b", { key: "wisdom_jobs_2" }),
      dbRow("c", { key: "wisdom_greene_1" }),
      dbRow("d", { key: "legacy_row" }),
    ]);

    const view = await buildWisdomFeed(4);
    const chipSum = Object.values(view.groupings.origin).reduce((a, b) => a + b, 0);

    // "all (N)" reads `loaded`; the origin chips read `groupings.origin`.
    // If these ever diverge, a chip promises rows the page cannot show.
    expect(chipSum).toBe(view.loaded);
    expect(view.loaded).toBe(view.entries.length);
    expect(chipSum).not.toBe(view.total); // the corpus is deliberately bigger
  });

  it("source groupings sum to loaded too", async () => {
    aggregate.mockResolvedValueOnce(agg(9, 3));
    findMany.mockResolvedValueOnce([dbRow("a"), dbRow("b"), dbRow("c")]);
    const view = await buildWisdomFeed(3);
    const sum = Object.values(view.groupings.source).reduce((a, b) => a + b, 0);
    expect(sum).toBe(view.loaded);
  });
});

describe("origin resolution comes from the shared registry", () => {
  it("prefers metadata.origin over the key prefix", async () => {
    aggregate.mockResolvedValueOnce(agg(1, 1));
    findMany.mockResolvedValueOnce([
      dbRow("a", { key: "wisdom_jobs_1", metadata: { origin: "satori" } }),
    ]);
    const view = await buildWisdomFeed();
    expect(view.entries[0].origin).toBe("satori");
  });

  it("resolves the prefixes the deleted local copy did not know", async () => {
    // `inferOrigin` here knew jobs/satori/distilled/from/nick_advice only;
    // these four lived in the two `inferOriginFromKey` copies.
    aggregate.mockResolvedValueOnce(agg(4, 4));
    findMany.mockResolvedValueOnce([
      dbRow("a", { key: "wisdom_buffett_moat" }),
      dbRow("b", { key: "wisdom_gates_scale" }),
      dbRow("c", { key: "wisdom_musk_delete" }),
      dbRow("d", { key: "wisdom_greene_law_1" }),
    ]);
    const view = await buildWisdomFeed();
    expect(view.entries.map((e) => e.origin)).toEqual([
      "warren-buffett",
      "bill-gates",
      "elon-musk",
      "greene-laws",
    ]);
  });

  it("still resolves nick_advice_ to chat-scrape", async () => {
    aggregate.mockResolvedValueOnce(agg(1, 1));
    findMany.mockResolvedValueOnce([dbRow("a", { key: "nick_advice_cm1" })]);
    const view = await buildWisdomFeed();
    expect(view.entries[0].origin).toBe("chat-scrape");
  });
});
