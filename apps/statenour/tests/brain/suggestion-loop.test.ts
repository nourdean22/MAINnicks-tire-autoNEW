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
  beforeEach(() => {
    vi.mocked(prisma.brainMemory.upsert).mockResolvedValue({
      id: "mem-1",
    } as never);
  });

  it("upserts a dismissed action under the sugg:<id>:action:<event> key", async () => {
    const result = await trackSuggestionAction({
      suggestionId: "weak-axis-fitness",
      suggestionKind: "weak-axis",
      event: "dismissed",
    });

    expect(result).toEqual({
      id: "mem-1",
      key: "sugg:weak-axis-fitness:action:dismissed",
    });
    expect(prisma.brainMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          category_key: {
            category: BRAIN_CATEGORIES.SUGGESTION_LOOP,
            key: "sugg:weak-axis-fitness:action:dismissed",
          },
        },
        create: expect.objectContaining({
          key: "sugg:weak-axis-fitness:action:dismissed",
          source: "suggestion-loop",
          createdBy: "suggestion-loop",
          metadata: expect.objectContaining({
            suggestionId: "weak-axis-fitness",
            event: "dismissed",
          }),
        }),
      }),
    );
  });

  it("weights each action event by training-signal strength", async () => {
    const cases: Array<{ event: string; confidence: number }> = [
      { event: "acted", confidence: 0.7 },
      { event: "dismissed", confidence: 0.6 },
      { event: "modified", confidence: 0.5 },
      { event: "deferred", confidence: 0.3 },
    ];
    for (const { event, confidence } of cases) {
      vi.mocked(prisma.brainMemory.upsert).mockClear();
      await trackSuggestionAction({
        suggestionId: "overdue-pile",
        suggestionKind: "overdue",
        event,
      });
      expect(prisma.brainMemory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ confidence }),
        }),
      );
    }
  });

  it("rejects an unknown action event without writing", async () => {
    await expect(
      trackSuggestionAction({
        suggestionId: "x",
        suggestionKind: "task",
        event: "ignored",
      }),
    ).rejects.toThrow();
    expect(prisma.brainMemory.upsert).not.toHaveBeenCalled();
  });

  it("rejects an empty suggestionId without writing", async () => {
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
  beforeEach(() => {
    vi.mocked(prisma.brainMemory.upsert).mockResolvedValue({
      id: "mem-2",
    } as never);
  });

  it("upserts an outcome under the sugg:<id>:outcome:<polarity> key", async () => {
    const result = await recordSuggestionOutcome({
      suggestionId: "stale-pin-1",
      suggestionKind: "stale-pin",
      polarity: "positive",
    });

    expect(result).toEqual({
      id: "mem-2",
      key: "sugg:stale-pin-1:outcome:positive",
    });
    expect(prisma.brainMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          category_key: {
            category: BRAIN_CATEGORIES.SUGGESTION_LOOP,
            key: "sugg:stale-pin-1:outcome:positive",
          },
        },
      }),
    );
  });

  it("weights outcomes — validated polarities strong, neutral weak", async () => {
    const cases: Array<{ polarity: string; confidence: number }> = [
      { polarity: "positive", confidence: 0.9 },
      { polarity: "negative", confidence: 0.9 },
      { polarity: "neutral", confidence: 0.4 },
    ];
    for (const { polarity, confidence } of cases) {
      vi.mocked(prisma.brainMemory.upsert).mockClear();
      await recordSuggestionOutcome({
        suggestionId: "research-thread",
        suggestionKind: "research",
        polarity,
      });
      expect(prisma.brainMemory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ confidence }),
        }),
      );
    }
  });

  it("rejects an unknown outcome polarity without writing", async () => {
    await expect(
      recordSuggestionOutcome({
        suggestionId: "x",
        suggestionKind: "task",
        polarity: "meh",
      }),
    ).rejects.toThrow();
    expect(prisma.brainMemory.upsert).not.toHaveBeenCalled();
  });
});
