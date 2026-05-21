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
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  getDismissedSuggestionIds,
  recordSuggestionOutcome,
  suggestionLoopStats,
  trackSuggestionAction,
} from "@/lib/brain/suggestion-loop";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/** A findMany row as getDismissedSuggestionIds sees it (select: metadata). */
const row = (suggestionId: unknown) => ({ metadata: { suggestionId } });

/** A brain_memory row as listSuggestionSignals → suggestionLoopStats sees it. */
const signalRow = (
  suggestionKind: string,
  opts: { event?: string; polarity?: string } = {},
) => ({
  confidence: 0.7,
  lastSeen: new Date(),
  metadata: { suggestionKind, suggestionId: `${suggestionKind}-x`, ...opts },
});

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

describe("suggestionLoopStats", () => {
  it("tallies action events per suggestion kind", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValueOnce([
      signalRow("task", { event: "acted" }),
      signalRow("task", { event: "acted" }),
      signalRow("task", { event: "dismissed" }),
    ] as never);

    const stats = await suggestionLoopStats();

    expect(stats.totalSignals).toBe(3);
    expect(stats.byKind.task).toMatchObject({
      acted: 2,
      dismissed: 1,
      modified: 0,
      deferred: 0,
    });
  });

  it("computes actionRate as acted / (acted + dismissed + modified + deferred)", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValueOnce([
      signalRow("goal", { event: "acted" }),
      signalRow("goal", { event: "acted" }),
      signalRow("goal", { event: "dismissed" }),
      signalRow("goal", { event: "modified" }),
    ] as never);

    const stats = await suggestionLoopStats();

    // 2 acted of 4 surfaced
    expect(stats.actionRate.goal).toBe(0.5);
  });

  it("computes positiveOutcomeRate as positive / (positive + negative + neutral)", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValueOnce([
      signalRow("sms", { polarity: "positive" }),
      signalRow("sms", { polarity: "positive" }),
      signalRow("sms", { polarity: "positive" }),
      signalRow("sms", { polarity: "negative" }),
    ] as never);

    const stats = await suggestionLoopStats();

    expect(stats.positiveOutcomeRate.sms).toBe(0.75);
  });

  it("keeps suggestion kinds independent", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValueOnce([
      signalRow("task", { event: "acted" }),
      signalRow("goal", { event: "dismissed" }),
    ] as never);

    const stats = await suggestionLoopStats();

    expect(stats.byKind.task).toMatchObject({ acted: 1, dismissed: 0 });
    expect(stats.byKind.goal).toMatchObject({ acted: 0, dismissed: 1 });
  });

  it("returns zero totals when there are no signals", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValueOnce([] as never);

    const stats = await suggestionLoopStats();

    expect(stats.totalSignals).toBe(0);
    expect(stats.byKind).toEqual({});
    expect(stats.actionRate).toEqual({});
  });

  it("reports actionRate 0 (not NaN) for a kind with only outcome signals", async () => {
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValueOnce([
      signalRow("research", { polarity: "positive" }),
      signalRow("research", { polarity: "neutral" }),
    ] as never);

    const stats = await suggestionLoopStats();

    // no action events surfaced → divide-by-zero guard yields 0, not NaN
    expect(stats.actionRate.research).toBe(0);
    expect(stats.positiveOutcomeRate.research).toBe(0.5);
  });
});

describe("trackSuggestionAction", () => {
  it("upserts an acted signal with the canonical key and metadata", async () => {
    vi.mocked(prisma.brainMemory.upsert).mockResolvedValueOnce({
      id: "mem-1",
    } as never);

    await trackSuggestionAction({
      suggestionId: "weak-axis-fitness",
      suggestionKind: "weak-axis",
      event: "acted",
    });

    expect(prisma.brainMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          category_key: {
            category: BRAIN_CATEGORIES.SUGGESTION_LOOP,
            key: "sugg:weak-axis-fitness:action:acted",
          },
        },
        create: expect.objectContaining({
          category: BRAIN_CATEGORIES.SUGGESTION_LOOP,
          key: "sugg:weak-axis-fitness:action:acted",
          confidence: 0.7,
          source: "suggestion-loop",
          createdBy: "suggestion-loop",
          metadata: expect.objectContaining({
            suggestionId: "weak-axis-fitness",
            suggestionKind: "weak-axis",
            event: "acted",
          }),
        }),
      }),
    );
  });

  it("maps each action event to its training-signal confidence", async () => {
    vi.mocked(prisma.brainMemory.upsert).mockResolvedValue({ id: "mem" } as never);
    const expected: Record<string, number> = {
      acted: 0.7,
      dismissed: 0.6,
      modified: 0.5,
      deferred: 0.3,
    };

    for (const [event, confidence] of Object.entries(expected)) {
      await trackSuggestionAction({
        suggestionId: "s1",
        suggestionKind: "task",
        event,
      });
      expect(prisma.brainMemory.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ confidence }),
        }),
      );
    }
  });

  it("returns the upserted row id and the canonical key", async () => {
    vi.mocked(prisma.brainMemory.upsert).mockResolvedValueOnce({
      id: "mem-xyz",
    } as never);

    const result = await trackSuggestionAction({
      suggestionId: "overdue-pile",
      suggestionKind: "overdue",
      event: "dismissed",
    });

    expect(result).toEqual({
      id: "mem-xyz",
      key: "sugg:overdue-pile:action:dismissed",
    });
  });

  it("rejects an unknown action event before touching the database", async () => {
    await expect(
      trackSuggestionAction({
        suggestionId: "s1",
        suggestionKind: "task",
        event: "ignored",
      }),
    ).rejects.toThrow();
    expect(prisma.brainMemory.upsert).not.toHaveBeenCalled();
  });

  it("rejects an empty suggestionId before touching the database", async () => {
    await expect(
      trackSuggestionAction({
        suggestionId: "",
        suggestionKind: "task",
        event: "acted",
      }),
    ).rejects.toThrow();
    expect(prisma.brainMemory.upsert).not.toHaveBeenCalled();
  });
});

describe("recordSuggestionOutcome", () => {
  it("upserts an outcome signal with the canonical outcome key", async () => {
    vi.mocked(prisma.brainMemory.upsert).mockResolvedValueOnce({
      id: "mem-o",
    } as never);

    await recordSuggestionOutcome({
      suggestionId: "broken-promise-1",
      suggestionKind: "broken-promise",
      polarity: "positive",
    });

    expect(prisma.brainMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          category_key: {
            category: BRAIN_CATEGORIES.SUGGESTION_LOOP,
            key: "sugg:broken-promise-1:outcome:positive",
          },
        },
        create: expect.objectContaining({
          key: "sugg:broken-promise-1:outcome:positive",
          confidence: 0.9,
          metadata: expect.objectContaining({ polarity: "positive" }),
        }),
      }),
    );
  });

  it("maps each outcome polarity to its confidence", async () => {
    vi.mocked(prisma.brainMemory.upsert).mockResolvedValue({ id: "mem" } as never);
    const expected: Record<string, number> = {
      positive: 0.9,
      negative: 0.9,
      neutral: 0.4,
    };

    for (const [polarity, confidence] of Object.entries(expected)) {
      await recordSuggestionOutcome({
        suggestionId: "s1",
        suggestionKind: "task",
        polarity,
      });
      expect(prisma.brainMemory.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ confidence }),
        }),
      );
    }
  });

  it("rejects an unknown outcome polarity before touching the database", async () => {
    await expect(
      recordSuggestionOutcome({
        suggestionId: "s1",
        suggestionKind: "task",
        polarity: "great",
      }),
    ).rejects.toThrow();
    expect(prisma.brainMemory.upsert).not.toHaveBeenCalled();
  });
});
