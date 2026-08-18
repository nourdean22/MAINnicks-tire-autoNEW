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
  buildUncalibratedNotice,
  enforceCalibration,
  hasCalibrationFooter,
} from "@/lib/ai/chat/calibration-enforcer";
import { parseEstimative } from "@/lib/ai/vnext/truth/estimative";

vi.mock("@/lib/ai/provider", () => ({ aiChat: vi.fn() }));

afterEach(async () => {
  vi.clearAllMocks();
  delete process.env.NICK_CALIBRATION_ENFORCER;
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

describe("footer format invariants", () => {
  it("the deterministic notice carries the marker and no probability", () => {
    const notice = buildUncalibratedNotice();
    expect(notice).toContain(CALIBRATION_MARKER);
    expect(parseEstimative(notice).likelihood).toBeNull(); // invents nothing
  });
});
