/**
 * suggestion-loop · getDismissedSuggestionIds — the VAD-style signal gate.
 *
 * getDismissedSuggestionIds backs the 2026-05-21 suggestion gate: it returns
 * the set of suggestionIds the operator dismissed within a recent window so
 * /api/nick/suggest can filter them out before ranking (a dismissed chip
 * stops re-firing on the 60s poll). These tests pin its behaviour — id
 * collection, Set de-duplication, defensive skipping of malformed metadata,
 * and the dismissed-only / non-deleted / windowed query shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { getDismissedSuggestionIds } from "@/lib/brain/suggestion-loop";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/** A findMany row as getDismissedSuggestionIds sees it (select: metadata). */
const row = (suggestionId: unknown) => ({ metadata: { suggestionId } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getDismissedSuggestionIds", () => {
  it("collects dismissed suggestionIds into a Set", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValueOnce([
      row("weak-axis-fitness"),
      row("overdue-pile"),
    ] as never);

    const ids = await getDismissedSuggestionIds();

    expect(ids).toBeInstanceOf(Set);
    expect([...ids].sort()).toEqual(["overdue-pile", "weak-axis-fitness"]);
  });

  it("de-dupes repeated suggestionIds", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValueOnce([
      row("stale-pin-7"),
      row("stale-pin-7"),
      row("stale-pin-7"),
    ] as never);

    const ids = await getDismissedSuggestionIds();

    expect(ids.size).toBe(1);
    expect(ids.has("stale-pin-7")).toBe(true);
  });

  it("skips rows with missing, empty, or non-string suggestionId", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValueOnce([
      row("contradictions"), // valid
      { metadata: {} }, // no suggestionId
      { metadata: null }, // null metadata
      row(""), // empty string
      row(42), // non-string
      row("orphan-nudge"), // valid
    ] as never);

    const ids = await getDismissedSuggestionIds();

    expect([...ids].sort()).toEqual(["contradictions", "orphan-nudge"]);
  });

  it("returns an empty Set when there are no dismissed rows", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValueOnce([] as never);

    const ids = await getDismissedSuggestionIds();

    expect(ids).toBeInstanceOf(Set);
    expect(ids.size).toBe(0);
  });

  it("queries only dismissed, non-deleted suggestion-loop rows within the window", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValueOnce([] as never);
    const NOW = 1_750_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW);

    await getDismissedSuggestionIds(3);

    expect(prisma.brainMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          category: BRAIN_CATEGORIES.SUGGESTION_LOOP,
          key: { endsWith: ":action:dismissed" },
          lastSeen: { gte: new Date(NOW - 3 * 24 * 60 * 60 * 1000) },
          deletedAt: null,
        },
        select: { metadata: true },
      }),
    );

    nowSpy.mockRestore();
  });
});
