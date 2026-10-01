/**
 * contentTopicSignals — customer language and rising search reach the miner,
 * and a failed read leaves the field UNDEFINED rather than fabricating a quiet
 * month (empty-vs-error).
 *
 * Positive control: with the error branch changed to `signals.customerQuestions
 * = []`, "left undefined on error" fails on `expect("customerQuestions" in
 * signals).toBe(false)`; with the cache check removed, "cached for 15 minutes"
 * fails on `toHaveBeenCalledTimes(1)` receiving 2.
 *
 * Every DB-backed sibling source is starved with getDb → null so the file
 * exercises only the two sources it owns. The cache is module-level, so each
 * test uses its own hour of `now` and never shares a window with another.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerLanguageResult } from "./customerLanguageMiner";

const h = vi.hoisted(() => ({
  mine: vi.fn<() => Promise<unknown>>(),
  rising: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../pipelines/instagram-data", () => ({
  getReelGenerationSignal: vi.fn(async () => ({ topThemes: [], signalSource: "reels" })),
}));
vi.mock("./declinedWorkSignals", () => ({
  fetchDeclinedWorkTopics: vi.fn(async () => ({ candidates: [], rowsConsidered: 0, confidence: "unverified_match" })),
}));
vi.mock("./customerLanguageMiner", () => ({ mineCustomerLanguage: h.mine }));
vi.mock("../pipelines/gsc-data", () => ({ getRisingQueries: h.rising }));

import { gatherTopicSignals } from "./contentTopicSignals";

const mined = (over: Partial<CustomerLanguageResult> = {}): CustomerLanguageResult => ({
  phrases: [
    { phrase: "steering wheel shakes", count: 7, lastSeenAt: "2026-09-29T10:00:00.000Z", sources: { calls: 5, sms: 2, reviews: 0, leads: 0 }, symptomTopic: "steering_shake" },
    { phrase: "check engine light on", count: 3, lastSeenAt: "2026-09-28T10:00:00.000Z", sources: { calls: 3, sms: 0, reviews: 0, leads: 0 }, symptomTopic: "check_engine_on" },
  ],
  sampled: 40,
  redactedTokens: 2,
  ...over,
});

// Each test gets its own cache window: a distinct day, well past the 15-minute TTL.
let day = 0;
const at = (minutes = 0) => new Date(Date.UTC(2026, 10, 1 + day, 12, minutes));

describe("gatherTopicSignals — customer language", () => {
  beforeEach(() => {
    day++;
    vi.clearAllMocks();
    h.rising.mockResolvedValue([]);
  });

  it("populates customerQuestions and counts from the miner", async () => {
    h.mine.mockResolvedValueOnce(mined());
    const { signals, failed, empty } = await gatherTopicSignals(at());
    expect(signals.customerQuestions).toEqual(["steering wheel shakes", "check engine light on"]);
    expect(signals.customerQuestionCounts).toEqual({ "steering wheel shakes": 7, "check engine light on": 3 });
    expect(failed).not.toContain("customer_questions");
    expect(empty).not.toContain("customer_questions");
    expect(h.mine).toHaveBeenCalledWith({ days: 30, now: at() });
  });

  it("leaves customerQuestions undefined on a miner error and records the failure", async () => {
    h.mine.mockResolvedValueOnce({ phrases: [], sampled: 0, redactedTokens: 0, error: "database unavailable" });
    const { signals, failed } = await gatherTopicSignals(at());
    expect("customerQuestions" in signals).toBe(false);
    expect(signals.customerQuestionCounts).toBeUndefined();
    expect(failed).toContain("customer_questions");
  });

  it("leaves customerQuestions undefined when the miner throws", async () => {
    h.mine.mockRejectedValueOnce(new Error("boom"));
    const { signals, failed } = await gatherTopicSignals(at());
    expect(signals.customerQuestions).toBeUndefined();
    expect(failed).toContain("customer_questions");
  });

  it("a measured zero is EMPTY, not failed", async () => {
    h.mine.mockResolvedValueOnce(mined({ phrases: [] }));
    const { signals, failed, empty } = await gatherTopicSignals(at());
    expect(signals.customerQuestions).toBeUndefined();
    expect(empty).toContain("customer_questions");
    expect(failed).not.toContain("customer_questions");
  });

  it("a partial read still populates but names the failed source", async () => {
    h.mine.mockResolvedValueOnce(mined({ failedSources: ["calls"] }));
    const { signals, failed } = await gatherTopicSignals(at());
    expect(signals.customerQuestions).toHaveLength(2);
    expect(failed).toContain("customer_questions:calls");
  });

  it("is cached for 15 minutes, keyed on the gather clock", async () => {
    h.mine.mockResolvedValue(mined());
    await gatherTopicSignals(at(0));
    await gatherTopicSignals(at(14));
    expect(h.mine).toHaveBeenCalledTimes(1);
    await gatherTopicSignals(at(16));
    expect(h.mine).toHaveBeenCalledTimes(2);
  });

  it("a cached failure is still reported as failed on the next gather", async () => {
    h.mine.mockResolvedValueOnce({ phrases: [], sampled: 0, redactedTokens: 0, error: "all sources failed" });
    const first = await gatherTopicSignals(at(0));
    const second = await gatherTopicSignals(at(5));
    expect(h.mine).toHaveBeenCalledTimes(1);
    expect(first.failed).toContain("customer_questions");
    expect(second.failed).toContain("customer_questions");
    expect(second.signals.customerQuestions).toBeUndefined();
  });
});

describe("gatherTopicSignals — rising search queries", () => {
  beforeEach(() => {
    day++;
    vi.clearAllMocks();
    h.mine.mockResolvedValue(mined({ phrases: [] }));
  });

  it("maps getRisingQueries into gscRising", async () => {
    h.rising.mockResolvedValueOnce([
      { query: "steering wheel shaking", impressions: 120, previousImpressions: 40, deltaImpressions: 80, clicks: 3, position: 8.4 },
    ]);
    const { signals, failed } = await gatherTopicSignals(at());
    expect(signals.gscRising).toEqual([{ query: "steering wheel shaking", impressions: 120, deltaImpressions: 80, position: 8.4 }]);
    expect(failed).not.toContain("gsc_rising");
    expect(h.rising).toHaveBeenCalledWith({ days: 7, limit: 15, now: at() });
  });

  it("records a thrown read as failed and leaves gscRising undefined", async () => {
    h.rising.mockRejectedValueOnce(new Error("database unavailable"));
    const { signals, failed, empty } = await gatherTopicSignals(at());
    expect(signals.gscRising).toBeUndefined();
    expect(failed).toContain("gsc_rising");
    expect(empty).not.toContain("gsc_rising");
  });

  it("nothing rising is EMPTY, not failed", async () => {
    h.rising.mockResolvedValueOnce([]);
    const { signals, failed, empty } = await gatherTopicSignals(at());
    expect(signals.gscRising).toBeUndefined();
    expect(empty).toContain("gsc_rising");
    expect(failed).not.toContain("gsc_rising");
  });
});
