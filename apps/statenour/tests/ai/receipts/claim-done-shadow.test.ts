/**
 * summarizeClaimDoneShadow — the persisted legacy-vs-strict "Done" gap.
 *
 * Imports the REAL receipt compiler and the REAL comparator (no re-implemented
 * copy). Positive control first: a successful write with no read-back is the
 * exact case the strict guard exists for, and it MUST show up as a gap.
 */
import { describe, it, expect } from "vitest";
import { summarizeClaimDoneShadow, toReceipt } from "@/lib/ai/receipts/action-receipt";

const NOW = "2026-09-15T15:00:00.000Z";

describe("summarizeClaimDoneShadow", () => {
  it("positive control: a successful write that was never read back is PROVIDER_ACCEPTED — legacy says Done, strict does not", () => {
    const r = toReceipt({ toolName: "sendTelegram", ok: true, sideEffecting: true }, { now: NOW });
    const s = summarizeClaimDoneShadow([r]);
    expect(s).toMatchObject({ legacyOk: true, strictOk: false, gap: true, receipts: 1, consequential: 1 });
    expect(s.strictOffenders).toEqual([
      { toolName: "sendTelegram", category: expect.any(String), status: "success", verificationState: "PROVIDER_ACCEPTED" },
    ]);
  });

  it("a write with an independent read-back is VERIFIED — no gap", () => {
    const r = toReceipt({ toolName: "createTask", ok: true, verified: true, sideEffecting: true }, { now: NOW });
    expect(summarizeClaimDoneShadow([r])).toMatchObject({ legacyOk: true, strictOk: true, gap: false, strictOffenders: [] });
  });

  it("a FAILED write is refused by both guards — not a gap, because legacy never allowed Done either", () => {
    const r = toReceipt({ toolName: "sendTelegram", ok: false, error: "boom", sideEffecting: true }, { now: NOW });
    const s = summarizeClaimDoneShadow([r]);
    expect(s).toMatchObject({ legacyOk: false, strictOk: false, gap: false });
    expect(s.strictOffenders[0]).toMatchObject({ verificationState: "FAILED_KNOWN" });
  });

  it("a successful known read never blocks either guard and is not consequential", () => {
    const r = toReceipt({ toolName: "lookup", ok: true, sideEffecting: false }, { now: NOW });
    expect(summarizeClaimDoneShadow([r])).toEqual({
      legacyOk: true,
      strictOk: true,
      gap: false,
      receipts: 1,
      consequential: 0,
      strictOffenders: [],
    });
  });

  it("mixed turn: one verified write + one provider-accepted write is still a gap, naming only the unproven one", () => {
    const ok = toReceipt({ toolName: "createTask", ok: true, verified: true, sideEffecting: true }, { now: NOW });
    const unproven = toReceipt({ toolName: "sendTelegram", ok: true, sideEffecting: true }, { now: NOW });
    const s = summarizeClaimDoneShadow([ok, unproven]);
    expect(s.gap).toBe(true);
    expect(s.consequential).toBe(2);
    expect(s.strictOffenders.map((o) => o.toolName)).toEqual(["sendTelegram"]);
  });

  it("is JSON-safe (round-trips without loss) so it can sit in tokenUsage", () => {
    const s = summarizeClaimDoneShadow([toReceipt({ toolName: "sendTelegram", ok: true, sideEffecting: true }, { now: NOW })]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
