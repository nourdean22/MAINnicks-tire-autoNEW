/**
 * Transfer artifact — the instrument that can finally emit a failure.
 *
 * The metric this replaces could not. `assistant-forwarded-call` is set whether
 * the counter answered or the call rang out to voicemail, so a connect rate
 * built on it returns a confident number that is independent of the thing it
 * claims to measure. These tests pin the one property that matters: absence of
 * evidence must resolve to UNKNOWN, never to connected.
 */
import { describe, expect, it } from "vitest";

import {
  MIN_CONNECT_SAMPLE,
  computeConnectRate,
  readTransferArtifact,
  transferArtifactWorthPersisting,
  type TransferVerdict,
} from "./transferArtifact";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const artifact = (transfers: unknown) => ({ transcript: "AI: hi", transfers });

describe("readTransferArtifact · absence is UNKNOWN, never connected", () => {
  it("no artifact at all", () => {
    const r = readTransferArtifact(undefined);
    expect(r.verdict).toBe("unknown");
    expect(r.artifactPresent).toBe(false);
  });

  it("artifact WITHOUT a transfers array — the org-gated case", () => {
    // VAPI describes blind-transfer outcome detection as enabled per org. If it
    // is off for this account, this is the shape every forwarded call has. It
    // must NOT read as a successful handoff.
    const r = readTransferArtifact({ transcript: "AI: transferring you now" });
    expect(r.verdict).toBe("unknown");
    expect(r.artifactPresent).toBe(false);
  });

  it("an EMPTY transfers array is still unknown, but records that the array existed", () => {
    const r = readTransferArtifact(artifact([]));
    expect(r.verdict).toBe("unknown");
    // The distinction matters: this account DOES emit the field.
    expect(r.artifactPresent).toBe(true);
  });

  it("hostile shapes never throw", () => {
    for (const bad of [null, 0, "", [], { transfers: "no" }, { transfers: [null, 7, "x"] }]) {
      expect(() => readTransferArtifact(bad)).not.toThrow();
      expect(readTransferArtifact(bad).verdict).toBe("unknown");
    }
  });
});

describe("readTransferArtifact · verdicts", () => {
  it.each([
    ["connected", "connected"],
    ["completed", "connected"],
    ["no-answer", "not_connected"],
    ["busy", "not_connected"],
    ["voicemail", "not_connected"],
    ["failed", "not_connected"],
    ["cancelled", "not_connected"],
  ])("status %s -> %s", (status, expected) => {
    const r = readTransferArtifact(artifact([{ destination: "+12165551234", mode: "blind-transfer", status }]));
    expect(r.verdict).toBe(expected as TransferVerdict);
  });

  it("cancelled is NOT connected — it is what the transfer assistant emits on voicemail or a decline", () => {
    expect(readTransferArtifact(artifact([{ status: "cancelled" }])).verdict).toBe("not_connected");
  });

  it("ANY connected attempt wins: busy then connected is a served customer", () => {
    // Scoring this as a failure would manufacture recovery work for someone who
    // already reached a human — the exact error class this wave repaired.
    const r = readTransferArtifact(artifact([{ status: "busy" }, { status: "connected" }]));
    expect(r.verdict).toBe("connected");
    expect(r.transfers).toHaveLength(2);
  });

  it("an unmodelled status is unknown, and the raw string is kept so drift is visible", () => {
    const r = readTransferArtifact(artifact([{ status: "ringing-forever" }]));
    expect(r.verdict).toBe("unknown");
    expect(r.unrecognisedStatuses).toContain("ringing-forever");
    expect(r.transfers[0].rawStatus).toBe("ringing-forever");
    expect(r.transfers[0].status).toBeNull();
  });

  it("keeps destination and mode for the routing view", () => {
    const r = readTransferArtifact(
      artifact([{ destination: "+12165551234", mode: "warm-transfer-experimental", status: "connected" }]),
    );
    expect(r.transfers[0].destination).toBe("+12165551234");
    expect(r.transfers[0].mode).toBe("warm-transfer-experimental");
  });
});

describe("computeConnectRate · refuses to produce a number it cannot support", () => {
  const many = (v: TransferVerdict, n: number): TransferVerdict[] => Array(n).fill(v);

  it("null below the minimum sample", () => {
    const r = computeConnectRate({ verdicts: many("connected", MIN_CONNECT_SAMPLE - 1) });
    expect(r.connectRate).toBeNull();
    expect(r.connected).toBe(MIN_CONNECT_SAMPLE - 1);
  });

  it("a real rate once classifiable", () => {
    const r = computeConnectRate({
      verdicts: [...many("connected", 8), ...many("not_connected", 2)],
    });
    expect(r.connectRate).toBe(80);
    expect(r.coveragePct).toBe(100);
  });

  it("UNKNOWNS NEVER INFLATE THE RATE — they lower coverage instead", () => {
    // The whole failure being replaced: a metric that turned silence into
    // success. 8 connected + 2 not-connected + 90 unknown is still 80%, but the
    // coverage number makes it obvious the rate rests on 10 of 100 calls.
    const r = computeConnectRate({
      verdicts: [...many("connected", 8), ...many("not_connected", 2), ...many("unknown", 90)],
    });
    expect(r.connectRate).toBe(80);
    expect(r.coveragePct).toBe(10);
    expect(r.unknown).toBe(90);
    expect(r.attempted).toBe(100);
  });

  it("all-unknown yields NO rate and zero coverage — not 0%, not 100%", () => {
    const r = computeConnectRate({ verdicts: many("unknown", 50) });
    expect(r.connectRate).toBeNull();
    expect(r.coveragePct).toBe(0);
  });

  it("an empty population reports null coverage rather than a fabricated 0", () => {
    const r = computeConnectRate({ verdicts: [] });
    expect(r.attempted).toBe(0);
    expect(r.connectRate).toBeNull();
    expect(r.coveragePct).toBeNull();
  });

  it("POSITIVE CONTROL: the rate genuinely moves with the data", () => {
    // Without this, a function hardcoded to return null would pass every
    // assertion above — the silent-instrument failure applied to its own test.
    const good = computeConnectRate({ verdicts: [...many("connected", 10)] });
    const bad = computeConnectRate({ verdicts: [...many("not_connected", 10)] });
    expect(good.connectRate).toBe(100);
    expect(bad.connectRate).toBe(0);
    expect(good.connectRate).not.toBe(bad.connectRate);
  });
});

describe("the defect this replaces", () => {
  it("a forwarded call with no transfer artifact is UNKNOWN, not a successful handoff", () => {
    // This is the entire point. Before this module, that call scored as a
    // successful transfer because assistant-forwarded-call was the only signal.
    const rangOutToVoicemail = readTransferArtifact({ transcript: "AI: one moment" });
    expect(rangOutToVoicemail.verdict).toBe("unknown");
    expect(rangOutToVoicemail.verdict).not.toBe("connected");

    const rate = computeConnectRate({ verdicts: [rangOutToVoicemail.verdict] });
    expect(rate.connected).toBe(0);
    expect(rate.connectRate).toBeNull();
  });
});

describe("transferArtifactWorthPersisting · a verdict only for a call that ATTEMPTED a transfer", () => {
  it("the 20-of-31 case: a transcript-only artifact on a call that never tried to hand off → NOT persisted", () => {
    // Vapi sends a transfers array - EMPTY - on a call that never transferred,
    // and an empty array still counts as artifactPresent. That is exactly what
    // the 20 rows carried, and exactly what the old test keyed on.
    const read = readTransferArtifact(artifact([]));
    expect(read.artifactPresent).toBe(true);
    expect(read.verdict).toBe("unknown");
    expect(transferArtifactWorthPersisting(read, "customer-ended-call")).toBe(false);
  });

  it("the coverage signal survives: a forwarded call with NO transfers array is persisted as unknown", () => {
    expect(transferArtifactWorthPersisting(readTransferArtifact({ transcript: "AI: transferring" }), "assistant-forwarded-call")).toBe(true);
    expect(transferArtifactWorthPersisting(readTransferArtifact(undefined), "assistant-forwarded-call")).toBe(true);
    expect(transferArtifactWorthPersisting(readTransferArtifact(artifact([])), "call.in-progress.error-transfer-failed")).toBe(true);
  });

  it("a per-attempt record is persisted whatever the ended reason says", () => {
    const read = readTransferArtifact(artifact([{ status: "connected", destination: "+12165550100" }]));
    expect(read.verdict).toBe("connected");
    expect(transferArtifactWorthPersisting(read, "customer-ended-call")).toBe(true);
    expect(transferArtifactWorthPersisting(read, null)).toBe(true);
  });

  it("the webhook CALLS it with the call's ended reason, and no longer keys on artifactPresent", () => {
    // Consumer pin on comment-stripped source: a decision nobody calls is no decision.
    const src = readFileSync(resolve(__dirname, "../routes/webhooks/vapi.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    // 2026-09-23: plus the live transfer-update witness read from the state trail.
    expect(src).toContain("transferArtifactWorthPersisting(read, cleanEndedReason, transferUpdateSeen)");
    expect(src).toContain("sawTransferUpdate(await getCallStateHistory(");
    expect(src).not.toContain("read.artifactPresent ||");
  });
});
