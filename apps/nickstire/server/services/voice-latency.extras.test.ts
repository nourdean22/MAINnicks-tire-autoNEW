/**
 * Voice-latency extras · wave-181.19 · Gap 3 + Gap 6 from test-analyzer audit
 *
 * Gap 3: quantile() math — off-by-one would silently miscompute p50/p95
 *        and either spam false-alarm breach-streak alerts or never fire
 *        them at all when real regressions land.
 *
 * Gap 6: captureVoiceLatency input guards — the only thing keeping
 *        bogus rows (typo stage names, negative latency, empty callId)
 *        out of voice_latency_events. A regression dropping these
 *        guards silently corrupts the data plane.
 */

import { describe, expect, it } from "vitest";
import { captureVoiceLatency, quantile } from "./voice-latency";

describe("quantile · nearest-rank (Gap 3)", () => {
  it("empty array returns 0", () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([], 0.95)).toBe(0);
  });

  it("single-element array returns that element", () => {
    expect(quantile([42], 0.5)).toBe(42);
    expect(quantile([42], 0.95)).toBe(42);
  });

  it("two-element array · p50 = first, p95 = second (nearest-rank)", () => {
    expect(quantile([100, 200], 0.5)).toBe(100);
    expect(quantile([100, 200], 0.95)).toBe(200);
  });

  it("1..100 evenly distributed · p50 = 50, p95 = 95", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(quantile(arr, 0.5)).toBe(50);
    expect(quantile(arr, 0.95)).toBe(95);
  });

  it("p100 returns max (the boundary case)", () => {
    expect(quantile([1, 2, 3, 4, 5], 1.0)).toBe(5);
  });
});

describe("captureVoiceLatency · input guards (Gap 6)", () => {
  it("returns ok=false when callId missing", async () => {
    const r = await captureVoiceLatency({
      callId: "",
      assistantId: "asst-1",
      stage: "stt_end",
      latencyMs: 100,
    });
    expect(r.ok).toBe(false);
  });

  it("returns ok=false when assistantId missing", async () => {
    const r = await captureVoiceLatency({
      callId: "call-1",
      assistantId: "",
      stage: "stt_end",
      latencyMs: 100,
    });
    expect(r.ok).toBe(false);
  });

  it("returns ok=false when stage is not in VOICE_LATENCY_STAGES", async () => {
    const r = await captureVoiceLatency({
      callId: "call-1",
      assistantId: "asst-1",
      // intentional typo — "stt-end" vs canonical "stt_end" with underscore
      stage: "stt-end" as unknown as "stt_end",
      latencyMs: 100,
    });
    expect(r.ok).toBe(false);
  });

  it("returns ok=false when latencyMs is negative", async () => {
    const r = await captureVoiceLatency({
      callId: "call-1",
      assistantId: "asst-1",
      stage: "stt_end",
      latencyMs: -5,
    });
    expect(r.ok).toBe(false);
  });

  it("returns ok=false when latencyMs is NaN or Infinity", async () => {
    const r1 = await captureVoiceLatency({
      callId: "call-1",
      assistantId: "asst-1",
      stage: "stt_end",
      latencyMs: NaN,
    });
    expect(r1.ok).toBe(false);

    const r2 = await captureVoiceLatency({
      callId: "call-1",
      assistantId: "asst-1",
      stage: "stt_end",
      latencyMs: Infinity,
    });
    expect(r2.ok).toBe(false);
  });
});
