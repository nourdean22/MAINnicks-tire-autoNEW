/**
 * Contract for the recommendation-novelty shadow recorder.
 *
 * The pure half (`checkNovelty`) has had tests since 2026-09-10 and zero
 * callers. This recorder is the caller, so the contract that matters is the
 * one between "what the draft named" and "what got recorded": a repeat must
 * land as a metric row, a non-resource turn must not, and — the case that
 * would lie in the audit's own direction — an unavailable prior set must
 * never be scored as "everything is fresh".
 */
import { describe, expect, it, vi } from "vitest";
import {
  RECOMMENDATION_NOVELTY_METRIC,
  recordRecommendationNoveltyShadow,
  summarizeForTags,
  type NoveltyShadowDeps,
} from "@/lib/ai/chat/recommendation-novelty-shadow";
import type { PriorRecommendation } from "@/lib/ai/chat/recommendation-novelty";
import { detectNamedSources } from "@/lib/ai/chat/named-source-claims";

// A draft the REAL extractor recognises — its own positive fixture — and the
// name it extracts from it. Priors are keyed on that extracted name, so the
// repeat is matched through the real detector, not through a guess at its
// normalisation. The first draft of this file guessed, and three tests skipped
// with "no names" while the recorder was correct.
const DRAFT = "You should listen to the Acquired podcast.";
const DETECTED_NAME = detectNamedSources(DRAFT)[0]?.name ?? "";

const NOW = new Date("2026-09-22T12:00:00Z");
const ARGS = {
  userContent: "recommend me some books on strategy",
  cleanedText: "",
  traceId: "t_1",
  conversationId: "c_1",
  createdAssistantId: "m_reply",
};

function prior(name: string, daysAgo = 3, timesSurfaced = 2): PriorRecommendation {
  return {
    name,
    timesSurfaced,
    lastSurfacedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
  } as PriorRecommendation;
}

function deps(over: Partial<NoveltyShadowDeps> = {}) {
  const recordMetric = vi.fn().mockResolvedValue({ id: "m1" });
  const alreadyRecorded = vi.fn().mockResolvedValue(false);
  const logInfo = vi.fn();
  const logError = vi.fn();
  const d: NoveltyShadowDeps = {
    expectsNamedResources: () => true,
    loadPriors: async () => ({ priors: [prior(DETECTED_NAME)], provenance: "OK" }),
    alreadyRecorded,
    recordMetric,
    logInfo,
    logError,
    now: () => NOW,
    ...over,
  };
  return { d, recordMetric, alreadyRecorded, logInfo, logError };
}

describe("recordRecommendationNoveltyShadow", () => {
  it("FIXTURE CONTROL: the real extractor recognises the draft at all", () => {
    expect(DETECTED_NAME).not.toBe("");
  });

  it("POSITIVE CONTROL: a re-served name is recorded with value = repeat count and the names in tags", async () => {
    const { d, recordMetric } = deps();
    const out = await recordRecommendationNoveltyShadow(
      { ...ARGS, cleanedText: DRAFT },
      d,
    );
    expect(out).toBe("recorded");
    expect(recordMetric).toHaveBeenCalledTimes(1);
    const [metric, value, opts] = recordMetric.mock.calls[0] as [string, number, { tags: Record<string, unknown>; source: string }];
    expect(metric).toBe(RECOMMENDATION_NOVELTY_METRIC);
    expect(value).toBe(1);
    expect(opts.source).toBe("recommendation-novelty-shadow");
    expect(opts.tags.repeatCount).toBe(1);
    expect(opts.tags.traceId).toBe("t_1");
    expect(JSON.stringify(opts.tags.repeats)).toContain(DETECTED_NAME);
  });

  it("a non-resource turn is skipped before priors are even loaded", async () => {
    const loadPriors = vi.fn();
    const { d, recordMetric } = deps({ expectsNamedResources: () => false, loadPriors });
    expect(await recordRecommendationNoveltyShadow(ARGS, d)).toBe("skipped_not_resource_turn");
    expect(loadPriors).not.toHaveBeenCalled();
    expect(recordMetric).not.toHaveBeenCalled();
  });

  it("a resource turn whose reply names nothing is skipped, not recorded as 0 repeats", async () => {
    const { d, recordMetric } = deps();
    expect(await recordRecommendationNoveltyShadow({ ...ARGS, cleanedText: "What kind of strategy — business or military?" }, d)).toBe(
      "skipped_no_names",
    );
    expect(recordMetric).not.toHaveBeenCalled();
  });

  // The case that would lie in the audit's own direction.
  it("EMPTY IS NOT ERROR: unavailable priors are never scored as all-fresh", async () => {
    const { d, recordMetric, logInfo } = deps({ loadPriors: async () => ({ priors: [], provenance: "ERROR" }) });
    const out = await recordRecommendationNoveltyShadow(
      { ...ARGS, cleanedText: DRAFT },
      d,
    );
    expect(out).toBe("skipped_priors_unavailable");
    expect(recordMetric).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith("recommendation_novelty_shadow_skipped", expect.objectContaining({ reason: "priors_unavailable" }));
  });

  it("ZERO priors (a genuinely empty history) IS scored — everything fresh is a real reading", async () => {
    const { d, recordMetric } = deps({ loadPriors: async () => ({ priors: [], provenance: "ZERO" }) });
    const out = await recordRecommendationNoveltyShadow(
      { ...ARGS, cleanedText: DRAFT },
      d,
    );
    expect(out).toBe("recorded");
    const [, value, opts] = recordMetric.mock.calls[0] as [string, number, { tags: Record<string, unknown> }];
    expect(value).toBe(0);
    expect(opts.tags.freshCount).toBe(1);
    expect(opts.tags.provenance).toBe("ZERO");
  });

  it("a BROKEN writer reports 'failed' under the shared instrument scope — never 'no repeats'", async () => {
    const { d, logError } = deps({ recordMetric: vi.fn().mockRejectedValue(new Error("db down")) });
    const out = await recordRecommendationNoveltyShadow(
      { ...ARGS, cleanedText: DRAFT },
      d,
    );
    expect(out).toBe("failed");
    expect(logError).toHaveBeenCalledTimes(1);
    expect(String(logError.mock.calls[0]?.[0])).toBe(`instrument.${RECOMMENDATION_NOVELTY_METRIC}`);
  });

  it("never throws into the turn — a shadow must not be able to break chat", async () => {
    const { d } = deps({ loadPriors: async () => { throw new Error("boom"); } });
    await expect(
      recordRecommendationNoveltyShadow({ ...ARGS, cleanedText: DRAFT }, d),
    ).resolves.toBe("failed");
  });

  // ── Review on PR #2485 (2026-09-22) ──────────────────────────────────────
  // The shadow runs AFTER the reply is persisted. A prior scan that includes
  // the reply's own row finds every name the draft used and calls all of
  // them repeats — the normal path was systematically false.
  it("P1 · the persisted reply is excluded from the prior scan", async () => {
    const loadPriors = vi.fn().mockResolvedValue({ priors: [], provenance: "ZERO" });
    const { d } = deps({ loadPriors });
    await recordRecommendationNoveltyShadow({ ...ARGS, cleanedText: DRAFT }, d);
    expect(loadPriors).toHaveBeenCalledTimes(1);
    expect(loadPriors).toHaveBeenCalledWith({ excludeMessageId: "m_reply" });
  });

  it("P1 · when persist skipped the reply there is nothing to exclude, and the loader is told so", async () => {
    const loadPriors = vi.fn().mockResolvedValue({ priors: [], provenance: "ZERO" });
    const { d } = deps({ loadPriors });
    await recordRecommendationNoveltyShadow({ ...ARGS, cleanedText: DRAFT, createdAssistantId: null }, d);
    expect(loadPriors).toHaveBeenCalledWith({ excludeMessageId: null });
  });

  // The post-turn outbox replays the whole deferred-work call after a crash
  // or an unmarked completion; a second row for the same turn inflates
  // writesInWindow and biases every rate read off these rows.
  it("P2 · the dedupe check runs on every resource turn that gets recorded", async () => {
    const { d, alreadyRecorded, recordMetric } = deps();
    expect(await recordRecommendationNoveltyShadow({ ...ARGS, cleanedText: DRAFT }, d)).toBe("recorded");
    expect(alreadyRecorded).toHaveBeenCalledTimes(1);
    expect(alreadyRecorded).toHaveBeenCalledWith("t_1");
    expect(recordMetric).toHaveBeenCalledTimes(1);
  });

  it("P2 · an outbox replay of an already-recorded trace writes nothing and never loads priors", async () => {
    const alreadyRecorded = vi.fn().mockResolvedValue(true);
    const loadPriors = vi.fn();
    const { d, recordMetric, logInfo } = deps({ loadPriors, alreadyRecorded });
    const out = await recordRecommendationNoveltyShadow({ ...ARGS, cleanedText: DRAFT }, d);
    expect(out).toBe("skipped_already_recorded");
    expect(loadPriors).not.toHaveBeenCalled();
    expect(recordMetric).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      "recommendation_novelty_shadow_skipped",
      expect.objectContaining({ reason: "already_recorded", traceId: "t_1" }),
    );
  });

  it("P2 · a broken dedupe reader reads as FAILING under the instrument scope — never as a second write", async () => {
    const { d, recordMetric, logError } = deps({
      alreadyRecorded: vi.fn().mockRejectedValue(new Error("db down")),
    });
    expect(await recordRecommendationNoveltyShadow({ ...ARGS, cleanedText: DRAFT }, d)).toBe("failed");
    expect(recordMetric).not.toHaveBeenCalled();
    expect(String(logError.mock.calls[0]?.[0])).toBe(`instrument.${RECOMMENDATION_NOVELTY_METRIC}`);
  });

  it("caps list tags so one enormous reply cannot bloat a metric row", () => {
    const fresh = Array.from({ length: 50 }, (_, i) => `Book ${i}`);
    const tags = summarizeForTags({ fresh, repeats: [], allRepeats: false, considered: 50 });
    expect(tags.freshCount).toBe(50);
    expect((tags.fresh as string[]).length).toBe(20);
  });
});
