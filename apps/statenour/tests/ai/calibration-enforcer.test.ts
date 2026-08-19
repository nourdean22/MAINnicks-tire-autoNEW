/**
 * tests/ai/calibration-enforcer.test.ts · the calibration lever.
 *
 * Detection is precision-first: a false positive appends a footer to a
 * non-forecast, a false negative is the status quo — so the negative
 * cases are the load-bearing ones. The enforcer's contract: never
 * invent a probability (elicitations that fail parseEstimative never
 * ship), never block persist (fail-open to the deterministic notice).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isForecastAsk,
  needsCalibration,
} from "@/lib/ai/vnext/truth/forecast-detector";
import {
  CALIBRATION_MARKER,
  aggregateSamples,
  buildUncalibratedNotice,
  enforceCalibration,
  getCalibrationK,
  hasCalibrationFooter,
} from "@/lib/ai/chat/calibration-enforcer";
import { bandForProbability, parseEstimative } from "@/lib/ai/vnext/truth/estimative";

vi.mock("@/lib/ai/provider", () => ({ aiChat: vi.fn() }));

// Single-shot tests pin k=1 so mock counts stay deterministic; the
// k-sample block below sets its own k.
process.env.NICK_CALIBRATION_K = "1";

afterEach(async () => {
  vi.clearAllMocks();
  delete process.env.NICK_CALIBRATION_ENFORCER;
  process.env.NICK_CALIBRATION_K = "1";
});

// The golden-set scenario ask + the 2.4/10 real failure reply shape.
const FORECAST_ASK =
  "We're running the Saturday promo — last two Saturdays we did 14 and 17 cars. Will we break 20 cars this Saturday? Give me your real estimate, not a maybe.";
const POINT_ESTIMATE_REPLY =
  "Estimated cars = 26. If the trend continued unchanged you'd hit 20; a targeted promo typically adds 20-30% traffic for local auto-service ads, so expect 26 cars.";

describe("isForecastAsk · fires on forecast-shaped asks", () => {
  it("matches the golden-set forecast scenario", () => {
    expect(isForecastAsk(FORECAST_ASK)).toBe(true);
  });

  it("matches the forecast verb family", () => {
    expect(isForecastAsk("what are the odds we clear the backlog by Friday?")).toBe(true);
    expect(isForecastAsk("give me a forecast for December revenue")).toBe(true);
    expect(isForecastAsk("are we going to hit the number this month?")).toBe(true);
    expect(isForecastAsk("chances we get the loaner back today?")).toBe(true);
  });
});

describe("isForecastAsk · refuses non-forecast asks (load-bearing)", () => {
  it("decision asks are not forecasts", () => {
    expect(isForecastAsk("should I hire another tech?")).toBe(false);
    expect(isForecastAsk("do you think I should raise prices?")).toBe(false);
  });

  it("diagnosis asks are not forecasts", () => {
    // persona-calibration-single-cause is governed by the prompt rule,
    // not this layer.
    expect(isForecastAsk("the alignment machine readings are drifting — what's causing it?")).toBe(false);
  });

  it("status reads and ordinary conversation are not forecasts", () => {
    expect(isForecastAsk("what were Friday's numbers?")).toBe(false);
    expect(isForecastAsk("summarize the meeting notes")).toBe(false);
  });
});

describe("needsCalibration · the skip taxonomy", () => {
  it("fires on the real failure shape: forecast ask + naked point estimate", () => {
    expect(needsCalibration(FORECAST_ASK, POINT_ESTIMATE_REPLY)).toEqual({ needed: true });
  });

  it("skips when the reply already carries band + confidence", () => {
    const calibrated =
      "Roughly even chance you break 20 — call it 50%. Confidence low: two data points, no promo baseline. [~50% · conf: low]";
    expect(needsCalibration(FORECAST_ASK, calibrated)).toEqual({
      needed: false,
      reason: "already-calibrated",
    });
  });

  it("skips the sanctioned honest path", () => {
    expect(
      needsCalibration(FORECAST_ASK, "Don't know — need to check the promo history first. Fastest real read: pull the last three promo Saturdays."),
    ).toEqual({ needed: false, reason: "honest-dont-know" });
  });

  it("skips clarifying questions back to the operator", () => {
    expect(needsCalibration(FORECAST_ASK, "Before I put a number on it — is the promo posted anywhere besides Instagram?")).toEqual({
      needed: false,
      reason: "question-back",
    });
  });

  it("business-metric percentages do NOT count as calibration (BDN-302 guard)", () => {
    // "adds 20-30% traffic" is a measurement claim, not a likelihood —
    // parseEstimative's cue gate keeps it out, so the footer still fires.
    expect(needsCalibration(FORECAST_ASK, POINT_ESTIMATE_REPLY)).toEqual({ needed: true });
  });
});

describe("enforceCalibration · elicit, validate, fail open", () => {
  it("appends a parseEstimative-readable footer when elicitation succeeds", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "Calibration: likely [~65% · conf: low] — two data points only",
      provider: "ollama",
      model: "gpt-oss:120b",
    } as never);

    const r = await enforceCalibration(FORECAST_ASK, POINT_ESTIMATE_REPLY);
    expect(r.action).toBe("elicited");
    expect(hasCalibrationFooter(r.text)).toBe(true);
    // The whole point: the augmented reply is now Brier-gradeable.
    const reading = parseEstimative(r.text);
    expect(reading.likelihood).toBeCloseTo(0.65, 5);
    expect(reading.confidence).toBe("low");
    expect(reading.tagged).toBe(true);
  });

  it("accepts a valid tag line even when the model drops the 'Calibration:' prefix", async () => {
    // First live run's lesson — prefix-matching starved the elicited
    // path. The tag is the contract, not the prefix.
    const { aiChat } = await import("@/lib/ai/provider");
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "likely [~70% · conf: moderate] — thin promo baseline",
      provider: "ollama",
      model: "gpt-oss:120b",
    } as never);

    const r = await enforceCalibration(FORECAST_ASK, POINT_ESTIMATE_REPLY);
    expect(r.action).toBe("elicited");
    expect(parseEstimative(r.text).likelihood).toBeCloseTo(0.7, 5);
  });

  it("REJECTS an elicitation that fails parseEstimative — never ships garbage", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "Calibration: pretty likely I guess",
      provider: "ollama",
      model: "x",
    } as never);

    const r = await enforceCalibration(FORECAST_ASK, POINT_ESTIMATE_REPLY);
    expect(r.action).toBe("fallback-notice");
    expect(r.text).toContain("uncalibrated");
  });

  it("treats the provider sentinel as failure (the repo gotcha)", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "I'm having trouble connecting to my AI providers right now.",
      provider: "emergency",
      model: "none",
    } as never);

    const r = await enforceCalibration(FORECAST_ASK, POINT_ESTIMATE_REPLY);
    expect(r.action).toBe("fallback-notice");
  });

  it("falls open to the notice when the provider throws", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    vi.mocked(aiChat).mockRejectedValueOnce(new Error("boom"));

    const r = await enforceCalibration(FORECAST_ASK, POINT_ESTIMATE_REPLY);
    expect(r.action).toBe("fallback-notice");
    expect(r.text.startsWith(POINT_ESTIMATE_REPLY)).toBe(true);
  });

  it("respects the kill-switch and never double-footers", async () => {
    process.env.NICK_CALIBRATION_ENFORCER = "0";
    const off = await enforceCalibration(FORECAST_ASK, POINT_ESTIMATE_REPLY);
    expect(off.action).toBe("skipped");
    expect(off.skipReason).toBe("kill-switch");
    delete process.env.NICK_CALIBRATION_ENFORCER;

    const already = `${POINT_ESTIMATE_REPLY}${buildUncalibratedNotice()}`;
    const second = await enforceCalibration(FORECAST_ASK, already);
    expect(second.action).toBe("skipped");
    expect(second.skipReason).toBe("already-footered");
    expect(second.text.match(new RegExp(String.raw`\[calibration`, "g"))?.length).toBe(1);
  });

  it("non-forecast turns pass through untouched", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    const r = await enforceCalibration("what were Friday's numbers?", "Friday closed at $4,120 across 11 cars.");
    expect(r.action).toBe("skipped");
    expect(r.skipReason).toBe("not-a-forecast-ask");
    expect(vi.mocked(aiChat)).not.toHaveBeenCalled();
  });
});

describe("k-sample upgrade · aggregation (pure)", () => {
  const s = (likelihood: number, confidence: "high" | "moderate" | "low", weakness: string | null = null) => ({
    likelihood,
    confidence,
    weakness,
  });

  it("takes the MEDIAN likelihood — robust to one outlier sample", () => {
    const agg = aggregateSamples([s(0.6, "moderate"), s(0.65, "moderate"), s(0.95, "high")]);
    expect(agg?.likelihood).toBeCloseTo(0.65, 5);
    expect(agg?.bandLabel).toBe("likely"); // words and number can never disagree
  });

  it("tight agreement keeps confidence; wide dispersion DOWNGRADES it", () => {
    const tight = aggregateSamples([s(0.6, "high"), s(0.62, "high"), s(0.65, "high")]);
    expect(tight?.confidence).toBe("high");
    expect(tight?.spreadPts).toBeCloseTo(5, 1);

    const wide = aggregateSamples([s(0.3, "high"), s(0.6, "high"), s(0.85, "high")]);
    expect(wide?.confidence).toBe("low"); // 55pt spread — agreement proxy wins
  });

  it("dispersion can only downgrade, never inflate, the stated confidence", () => {
    // Samples agree tightly but the model itself says the evidence is
    // weak — tight agreement must NOT promote low to high.
    const agg = aggregateSamples([s(0.5, "low"), s(0.5, "low"), s(0.52, "low")]);
    expect(agg?.confidence).toBe("low");
  });

  it("even sample counts average the middle pair", () => {
    const agg = aggregateSamples([s(0.4, "moderate"), s(0.6, "moderate")]);
    expect(agg?.likelihood).toBeCloseTo(0.5, 5);
    expect(agg?.bandLabel).toBe("roughly even chance");
  });

  it("single valid sample degrades gracefully; zero returns null", () => {
    const one = aggregateSamples([s(0.7, "moderate", "thin baseline")]);
    expect(one?.validCount).toBe(1);
    expect(one?.spreadPts).toBe(0);
    expect(one?.weakness).toBe("thin baseline");
    expect(aggregateSamples([])).toBeNull();
  });
});

describe("k-sample upgrade · bandForProbability (pure)", () => {
  it("maps contained probabilities to their band", () => {
    expect(bandForProbability(0.65)?.label).toBe("likely");
    expect(bandForProbability(0.5)?.label).toBe("roughly even chance");
    expect(bandForProbability(0.03)?.label).toBe("almost no chance");
  });

  it("edge-gap probabilities snap to the nearest band instead of failing", () => {
    expect(bandForProbability(0.005)?.label).toBe("almost no chance");
    expect(bandForProbability(0.999)?.label).toBe("almost certain");
  });

  it("rejects out-of-range input", () => {
    expect(bandForProbability(-0.1)).toBeNull();
    expect(bandForProbability(1.5)).toBeNull();
    expect(bandForProbability(Number.NaN)).toBeNull();
  });
});

describe("k-sample upgrade · enforceCalibration with k=3", () => {
  it("fires k concurrent elicitations and aggregates the valid ones", async () => {
    process.env.NICK_CALIBRATION_K = "3";
    const { aiChat } = await import("@/lib/ai/provider");
    vi.mocked(aiChat)
      .mockResolvedValueOnce({
        content: "Calibration: likely [~60% · conf: moderate] — two data points",
        provider: "ollama",
        model: "x",
      } as never)
      .mockResolvedValueOnce({
        content: "Calibration: likely [~70% · conf: high] — promo lift unknown",
        provider: "ollama",
        model: "x",
      } as never)
      .mockResolvedValueOnce({
        content: "garbage with no tag",
        provider: "ollama",
        model: "x",
      } as never);

    const r = await enforceCalibration(FORECAST_ASK, POINT_ESTIMATE_REPLY);
    expect(r.action).toBe("elicited");
    expect(vi.mocked(aiChat)).toHaveBeenCalledTimes(3);
    // median of [60,70] = 65 · spread 10pts → dispersion high, stated
    // median moderate → conservative min = moderate
    const reading = parseEstimative(r.text);
    expect(reading.likelihood).toBeCloseTo(0.65, 5);
    expect(reading.confidence).toBe("moderate");
    expect(r.text).toContain("(k=3 · 2 valid · spread 10pts)");
  });

  it("clamps and defaults NICK_CALIBRATION_K sanely", () => {
    process.env.NICK_CALIBRATION_K = "99";
    expect(getCalibrationK()).toBe(5);
    process.env.NICK_CALIBRATION_K = "abc";
    expect(getCalibrationK()).toBe(3);
    process.env.NICK_CALIBRATION_K = "0";
    expect(getCalibrationK()).toBe(1);
    delete process.env.NICK_CALIBRATION_K;
    expect(getCalibrationK()).toBe(3); // operator-ordered default
  });
});

describe("footer format invariants", () => {
  it("the deterministic notice carries the marker and no probability", () => {
    const notice = buildUncalibratedNotice();
    expect(notice).toContain(CALIBRATION_MARKER);
    expect(parseEstimative(notice).likelihood).toBeNull(); // invents nothing
  });
});
