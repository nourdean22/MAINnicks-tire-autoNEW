/**
 * Missed-call recovery eligibility (Wave F). The DB/send path is
 * integration-level; these lock the pure rule that decides WHO gets a
 * follow-up text — the part that must never be wrong on a live outbound
 * SMS channel.
 */
import { describe, it, expect } from "vitest";
import { isMissedCallEligible, type MissedCallRow } from "../cron/jobs/missedCallRecovery";

const T0 = 1_790_000_000_000;
const MIN = 60 * 1000;

const base = (over: Partial<MissedCallRow> = {}): MissedCallRow => ({
  id: 1,
  vapiCallId: "call-1",
  phoneNumber: "2165551234",
  durationSeconds: 40,
  convertedToLead: 0,
  leadId: null,
  callbackId: null,
  recoveryAlreadyStamped: false,
  createdAtMs: T0 - 90 * MIN, // 90 min ago → inside [45min, 24h]
  ...over,
});

describe("isMissedCallEligible", () => {
  it("eligible: unconverted real call, in the window, not yet recovered", () => {
    expect(isMissedCallEligible(base(), T0)).toBe(true);
    expect(isMissedCallEligible(base({ createdAtMs: T0 - 45 * MIN }), T0)).toBe(true); // lower edge
    expect(isMissedCallEligible(base({ createdAtMs: T0 - 24 * 60 * MIN }), T0)).toBe(true); // upper edge
  });

  it("NOT eligible without a phone number", () => {
    expect(isMissedCallEligible(base({ phoneNumber: null }), T0)).toBe(false);
  });

  it("NOT eligible if the call already converted or was captured", () => {
    expect(isMissedCallEligible(base({ convertedToLead: 1 }), T0)).toBe(false);
    expect(isMissedCallEligible(base({ leadId: 7 }), T0)).toBe(false);
    expect(isMissedCallEligible(base({ callbackId: 9 }), T0)).toBe(false);
  });

  it("NOT eligible once a recovery text was already stamped (one-shot)", () => {
    expect(isMissedCallEligible(base({ recoveryAlreadyStamped: true }), T0)).toBe(false);
  });

  it("NOT eligible for hangups / robocalls (< 15s)", () => {
    expect(isMissedCallEligible(base({ durationSeconds: 14 }), T0)).toBe(false);
    expect(isMissedCallEligible(base({ durationSeconds: 3 }), T0)).toBe(false);
  });

  it("NOT eligible too soon (< 45 min — shop's own callback goes first) or too old (> 24h)", () => {
    expect(isMissedCallEligible(base({ createdAtMs: T0 - 30 * MIN }), T0)).toBe(false);
    expect(isMissedCallEligible(base({ createdAtMs: T0 - 25 * 60 * MIN }), T0)).toBe(false);
  });
});
