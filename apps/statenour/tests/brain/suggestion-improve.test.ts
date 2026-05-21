/**
 * suggestion-improve · turns suggestion-loop signals into per-kind
 * improvement hypotheses (operator-facing, surfaced on /brain/wisdom).
 *
 * Pins the three behaviours: the noisy-kind verdict (dismissRate ≥ 0.5
 * over ≥ 5 signals), the persistence shape, and the failure-isolation
 * guarantee that lets it share a cron with improve-agent safely.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/brain/suggestion-loop", () => ({
  suggestionLoopStats: vi.fn(),
}));

vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { remember: vi.fn() },
}));

import { suggestionLoopStats } from "@/lib/brain/suggestion-loop";
import { brainMemory } from "@/lib/brain/memory-manager";
import {
  analyzeSuggestionLoop,
  persistSuggestionHypotheses,
  runSuggestionImproveAgent,
  type SuggestionHypothesis,
} from "@/lib/brain/suggestion-improve";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/** A per-kind stats bucket as suggestionLoopStats().byKind holds. */
function bucket(over: Record<string, number> = {}) {
  return {
    acted: 0,
    dismissed: 0,
    modified: 0,
    deferred: 0,
    positive: 0,
    negative: 0,
    neutral: 0,
    ...over,
  };
}

/** Wrap a byKind map as a suggestionLoopStats() resolved value. */
function statsOf(byKind: Record<string, ReturnType<typeof bucket>>) {
  return { totalSignals: 0, byKind, actionRate: {}, positiveOutcomeRate: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("analyzeSuggestionLoop", () => {
  it("flags a kind dismissed past the noisy threshold", async () => {
    vi.mocked(suggestionLoopStats).mockResolvedValueOnce(
      statsOf({ "weak-axis": bucket({ acted: 2, dismissed: 12, modified: 1 }) }) as never,
    );

    const [h, ...rest] = await analyzeSuggestionLoop();

    expect(rest).toHaveLength(0);
    expect(h.kind).toBe("weak-axis");
    expect(h.signalCount).toBe(15);
    expect(h.dismissed).toBe(12);
    expect(h.dismissRate).toBe(0.8);
    expect(h.verdict).toBe("noisy");
    expect(h.summary).toContain("weak-axis");
    expect(h.summary).toContain("12/15");
    expect(h.summary).toContain("80%");
  });

  it("skips a kind below the 5-signal gate", async () => {
    vi.mocked(suggestionLoopStats).mockResolvedValueOnce(
      statsOf({ "stuck-task": bucket({ dismissed: 3 }) }) as never,
    );
    expect(await analyzeSuggestionLoop()).toEqual([]);
  });

  it("skips a kind the operator mostly acts on", async () => {
    vi.mocked(suggestionLoopStats).mockResolvedValueOnce(
      statsOf({ overdue: bucket({ acted: 8, dismissed: 2 }) }) as never,
    );
    expect(await analyzeSuggestionLoop()).toEqual([]);
  });

  it("treats an exact 50% dismiss rate as noisy", async () => {
    vi.mocked(suggestionLoopStats).mockResolvedValueOnce(
      statsOf({ pattern: bucket({ acted: 3, dismissed: 3 }) }) as never,
    );
    const result = await analyzeSuggestionLoop();
    expect(result).toHaveLength(1);
    const [h] = result;
    expect(h.dismissRate).toBe(0.5);
  });

  it("returns nothing for an empty byKind", async () => {
    vi.mocked(suggestionLoopStats).mockResolvedValueOnce(statsOf({}) as never);
    expect(await analyzeSuggestionLoop()).toEqual([]);
  });

  it("orders the noisiest kind first", async () => {
    vi.mocked(suggestionLoopStats).mockResolvedValueOnce(
      statsOf({
        "weak-axis": bucket({ acted: 1, dismissed: 9 }), // 0.9
        overdue: bucket({ acted: 4, dismissed: 6 }), // 0.6
      }) as never,
    );
    const result = await analyzeSuggestionLoop();
    expect(result.map((h) => h.kind)).toEqual(["weak-axis", "overdue"]);
  });
});

describe("persistSuggestionHypotheses", () => {
  const hypothesis: SuggestionHypothesis = {
    kind: "weak-axis",
    signalCount: 15,
    acted: 2,
    dismissed: 12,
    dismissRate: 0.8,
    actionRate: 0.13,
    verdict: "noisy",
    summary: "weak-axis · 12/15 dismissed (80%) …",
  };

  it("writes one suggestion_hypothesis memory per hypothesis", async () => {
    vi.mocked(brainMemory.remember).mockResolvedValue(undefined as never);

    const written = await persistSuggestionHypotheses([hypothesis]);

    expect(written).toBe(1);
    expect(brainMemory.remember).toHaveBeenCalledWith(
      BRAIN_CATEGORIES.SUGGESTION_HYPOTHESIS,
      expect.stringMatching(/^suggestion_hyp_weak-axis_\d{4}-\d{2}-\d{2}$/),
      hypothesis.summary,
      "suggestion-improve",
      expect.objectContaining({
        kind: "weak-axis",
        dismissed: 12,
        dismissRate: 0.8,
        verdict: "noisy",
      }),
    );
  });

  it("writes nothing and returns 0 for an empty list", async () => {
    expect(await persistSuggestionHypotheses([])).toBe(0);
    expect(brainMemory.remember).not.toHaveBeenCalled();
  });

  it("skips a failed write without throwing", async () => {
    vi.mocked(brainMemory.remember).mockRejectedValue(new Error("db down"));
    await expect(persistSuggestionHypotheses([hypothesis])).resolves.toBe(0);
  });
});

describe("runSuggestionImproveAgent", () => {
  it("analyzes then persists on the happy path", async () => {
    vi.mocked(suggestionLoopStats).mockResolvedValueOnce(
      statsOf({ "weak-axis": bucket({ acted: 2, dismissed: 12 }) }) as never,
    );
    vi.mocked(brainMemory.remember).mockResolvedValue(undefined as never);

    const result = await runSuggestionImproveAgent();

    expect(result.hypotheses).toHaveLength(1);
    expect(result.persisted).toBe(1);
  });

  it("returns an empty result when suggestionLoopStats throws — never breaks the shared cron", async () => {
    vi.mocked(suggestionLoopStats).mockRejectedValueOnce(new Error("stats failed"));

    const result = await runSuggestionImproveAgent();

    expect(result).toEqual({ hypotheses: [], persisted: 0 });
  });
});
