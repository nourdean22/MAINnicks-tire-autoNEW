import { describe, expect, it } from "vitest";
import {
  computeWarmTransferConnectRate,
  isForwardCompleted,
  isTransferFailure,
  DEFAULT_PRE_TRANSFER_FLOOR_SEC,
  MIN_RELIABLE_SAMPLE,
} from "../lib/warmTransferConnect";

const LONG = DEFAULT_PRE_TRANSFER_FLOOR_SEC + 60; // clears the connect floor
const SHORT = DEFAULT_PRE_TRANSFER_FLOOR_SEC - 20; // below the floor

describe("isForwardCompleted / isTransferFailure", () => {
  it("a completed forward is a forward, never a failure", () => {
    expect(isForwardCompleted("assistant-forwarded-call")).toBe(true);
    expect(isTransferFailure("assistant-forwarded-call")).toBe(false);
  });

  it("a transfer error is a failure, never a completed forward (disjoint)", () => {
    for (const r of [
      "error-warm-transfer-silence-timeout",
      "error-warm-transfer-max-duration",
      "call.in-progress.error-transfer-failed",
      "customer-ended-call-after-warm-transfer-attempt",
    ]) {
      expect(isTransferFailure(r)).toBe(true);
      expect(isForwardCompleted(r)).toBe(false);
    }
  });

  it("a plain end reason is neither", () => {
    expect(isForwardCompleted("customer-ended-call")).toBe(false);
    expect(isTransferFailure("customer-ended-call")).toBe(false);
    expect(isForwardCompleted(null)).toBe(false);
    expect(isTransferFailure(undefined)).toBe(false);
  });
});

describe("computeWarmTransferConnectRate", () => {
  it("empty input → zeros, rate null (never NaN, never reliable)", () => {
    expect(computeWarmTransferConnectRate([])).toEqual({
      attempted: 0,
      connected: 0,
      failed: 0,
      rate: null,
      reliable: false,
    });
  });

  it("a completed forward over the floor counts as inferred-connected", () => {
    const r = computeWarmTransferConnectRate([{ endedReason: "assistant-forwarded-call", durationSeconds: LONG }]);
    expect(r.attempted).toBe(1);
    expect(r.connected).toBe(1);
    expect(r.failed).toBe(0);
  });

  it("a completed forward UNDER the floor is attempted but not connected", () => {
    const r = computeWarmTransferConnectRate([{ endedReason: "assistant-forwarded-call", durationSeconds: SHORT }]);
    expect(r.attempted).toBe(1);
    expect(r.connected).toBe(0);
  });

  it("a transfer failure is ground-truth no-connect: counts in attempted + failed, never connected", () => {
    const r = computeWarmTransferConnectRate([
      { endedReason: "error-warm-transfer-silence-timeout", durationSeconds: LONG }, // long but FAILED → not connected
    ]);
    expect(r.attempted).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.connected).toBe(0);
  });

  it("non-forward calls are excluded from the denominator entirely", () => {
    const r = computeWarmTransferConnectRate([
      { endedReason: "customer-ended-call", durationSeconds: LONG },
      { endedReason: "assistant-ended-call", durationSeconds: LONG },
      { endedReason: null, durationSeconds: LONG },
    ]);
    expect(r.attempted).toBe(0);
    expect(r.rate).toBeNull();
  });

  it("withholds the % until the sample is reliable, then reports connected/attempted", () => {
    // 9 completed forwards (all connected) — below MIN_RELIABLE_SAMPLE → no %.
    const nine = Array.from({ length: MIN_RELIABLE_SAMPLE - 1 }, () => ({
      endedReason: "assistant-forwarded-call",
      durationSeconds: LONG,
    }));
    const low = computeWarmTransferConnectRate(nine);
    expect(low.attempted).toBe(MIN_RELIABLE_SAMPLE - 1);
    expect(low.reliable).toBe(false);
    expect(low.rate).toBeNull();

    // 6 long + 2 short completed + 2 failed = 10 attempted, 6 connected → 60%.
    const ten: { endedReason: string; durationSeconds: number }[] = [
      ...Array.from({ length: 6 }, () => ({ endedReason: "assistant-forwarded-call", durationSeconds: LONG })),
      ...Array.from({ length: 2 }, () => ({ endedReason: "assistant-forwarded-call", durationSeconds: SHORT })),
      ...Array.from({ length: 2 }, () => ({ endedReason: "error-warm-transfer-max-duration", durationSeconds: LONG })),
    ];
    const ok = computeWarmTransferConnectRate(ten);
    expect(ok.attempted).toBe(10);
    expect(ok.connected).toBe(6);
    expect(ok.failed).toBe(2);
    expect(ok.reliable).toBe(true);
    expect(ok.rate).toBe(60);
  });

  it("honors a custom floor and sample threshold", () => {
    const r = computeWarmTransferConnectRate(
      [{ endedReason: "assistant-forwarded-call", durationSeconds: 30 }],
      { preTransferFloorSec: 20, minReliableSample: 1 },
    );
    expect(r.connected).toBe(1);
    expect(r.reliable).toBe(true);
    expect(r.rate).toBe(100);
  });
});
