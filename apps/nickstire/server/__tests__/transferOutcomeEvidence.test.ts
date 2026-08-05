/**
 * Redial-evidence model for forwarded calls (2026-08-05).
 *
 * Prod signature this encodes: callers redialing 15-16 times within minutes of
 * being forwarded — observable no-answer evidence. The contract's honesty
 * split: redialed (evidence of failure) / quiet (absence, NOT proof of
 * success) / tooRecent (window hasn't elapsed — excluded from denominators)
 * / failedTransfers (VAPI ground truth).
 */
import { describe, expect, it } from "vitest";
import {
  computeTransferOutcomeEvidence,
  DEFAULT_REDIAL_WINDOW_MIN,
} from "../lib/transferOutcomeEvidence";

const BASE = new Date("2026-08-01T15:00:00Z").getTime();
const ASOF = new Date(BASE + 24 * 60 * 60_000); // a day later — nothing tooRecent
const at = (minOffset: number) => new Date(BASE + minOffset * 60_000);
const fwd = (phone: string | null, minOffset: number) => ({
  phoneNumber: phone, createdAt: at(minOffset), endedReason: "assistant-forwarded-call",
});
const call = (phone: string | null, minOffset: number, reason = "customer-ended-call") => ({
  phoneNumber: phone, createdAt: at(minOffset), endedReason: reason,
});

describe("computeTransferOutcomeEvidence", () => {
  it("a forward followed by a same-phone call inside the window is REDIALED", () => {
    const r = computeTransferOutcomeEvidence(
      [fwd("+12165551234", 0), call("2165551234", 5)], // formats differ, same last-10
      { asOf: ASOF, minReliableSample: 1 },
    );
    expect(r.forwards).toBe(1);
    expect(r.redialed).toBe(1);
    expect(r.quiet).toBe(0);
    expect(r.redialRate).toBe(100);
  });

  it("a forward with no later call inside the window is QUIET (absence, not proof)", () => {
    const r = computeTransferOutcomeEvidence(
      [fwd("2165551234", 0), call("2165551234", DEFAULT_REDIAL_WINDOW_MIN + 1)],
      { asOf: ASOF, minReliableSample: 1 },
    );
    expect(r.redialed).toBe(0);
    expect(r.quiet).toBe(1);
  });

  it("a call from a DIFFERENT phone never counts as a redial", () => {
    const r = computeTransferOutcomeEvidence(
      [fwd("2165551234", 0), call("2165559999", 3)],
      { asOf: ASOF, minReliableSample: 1 },
    );
    expect(r.redialed).toBe(0);
    expect(r.quiet).toBe(1);
  });

  it("an earlier call from the same phone is not a redial (strictly later only)", () => {
    const r = computeTransferOutcomeEvidence(
      [call("2165551234", -5), fwd("2165551234", 0)],
      { asOf: ASOF, minReliableSample: 1 },
    );
    expect(r.redialed).toBe(0);
    expect(r.quiet).toBe(1);
  });

  it("a forward younger than the window at compute time is TOO RECENT — excluded from the rate", () => {
    const r = computeTransferOutcomeEvidence(
      [fwd("2165551234", 0)],
      { asOf: new Date(BASE + 5 * 60_000), minReliableSample: 1 }, // 5 min after
    );
    expect(r.tooRecent).toBe(1);
    expect(r.classifiable).toBe(0);
    expect(r.redialRate).toBeNull();
  });

  it("the redial-burst signature: each forward in a chain counts redialed except the last", () => {
    // 2168351043-style burst: forward, redial+forward, redial+forward, silence
    const rows = [fwd("2168351043", 0), fwd("2168351043", 4), fwd("2168351043", 9)];
    const r = computeTransferOutcomeEvidence(rows, { asOf: ASOF, minReliableSample: 1 });
    expect(r.forwards).toBe(3);
    expect(r.redialed).toBe(2);
    expect(r.quiet).toBe(1);
  });

  it("failed transfers are ground truth, kept out of the redial denominators", () => {
    const r = computeTransferOutcomeEvidence(
      [call("2165551234", 0, "error-warm-transfer-silence-timeout"), fwd("2165559999", 0)],
      { asOf: ASOF, minReliableSample: 1 },
    );
    expect(r.failedTransfers).toBe(1);
    expect(r.attempted).toBe(2);
    expect(r.classifiable).toBe(1);
  });

  it("withholds the rate below the reliable sample", () => {
    const rows = Array.from({ length: 9 }, (_, i) => fwd(`216555${1000 + i}`, i));
    const r = computeTransferOutcomeEvidence(rows, { asOf: ASOF });
    expect(r.classifiable).toBe(9);
    expect(r.reliable).toBe(false);
    expect(r.redialRate).toBeNull();
  });

  it("a forward with no usable phone can never be redialed — lands in quiet", () => {
    const r = computeTransferOutcomeEvidence([fwd(null, 0), fwd("123", 1)], {
      asOf: ASOF, minReliableSample: 1,
    });
    expect(r.forwards).toBe(2);
    expect(r.quiet).toBe(2);
  });

  it("empty input → zeros, rate null", () => {
    const r = computeTransferOutcomeEvidence([], { asOf: ASOF });
    expect(r).toMatchObject({ forwards: 0, redialed: 0, quiet: 0, redialRate: null, reliable: false });
  });
});
