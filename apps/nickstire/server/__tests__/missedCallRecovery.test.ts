/**
 * Missed-call recovery eligibility (Wave F). The DB/send path is
 * integration-level; these lock the pure rule that decides WHO gets a
 * follow-up text — the part that must never be wrong on a live outbound
 * SMS channel.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { isMissedCallEligible, processMissedCallRecovery, type MissedCallRow } from "../cron/jobs/missedCallRecovery";

const h = vi.hoisted(() => ({
  callRows: [] as Array<Record<string, unknown>>,
  evidence: {} as Record<string, Record<string, unknown>>,
  evidenceCalls: [] as string[],
  sent: [] as string[],
}));

vi.mock("../db", () => ({
  getDbTyped: async () => ({
    select: () => ({
      from: () => ({
        // calls query: .where().orderBy().limit(); opt-out query: await .where()
        where: () => Object.assign(Promise.resolve([]), { orderBy: () => ({ limit: async () => h.callRows }) }),
      }),
    }),
    execute: async () => [{ affectedRows: 1 }], // the at-most-once claim
  }),
}));
vi.mock("../services/featureFlags", () => ({ isEnabled: async () => true }));
vi.mock("../services/vapiActionExtraction", () => ({
  loadCallCaptureEvidence: async (callId: string) => {
    h.evidenceCalls.push(callId);
    return h.evidence[callId] ?? {};
  },
}));
vi.mock("../services/smsOrchestrator", () => ({
  orchestrateSms: async (input: { vapiCallId: string }) => {
    h.sent.push(input.vapiCallId);
    return { status: "sent" };
  },
}));
vi.mock("../services/telegram", () => ({ sendTelegram: async () => undefined }));

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

  it("NOT eligible if the call was captured (lead or callback)", () => {
    expect(isMissedCallEligible(base({ leadId: 7 }), T0)).toBe(false);
    expect(isMissedCallEligible(base({ callbackId: 9 }), T0)).toBe(false);
  });

  it("a call that reached a tool is eligible ONLY with proof it captured nothing (2026-10-02)", () => {
    expect(isMissedCallEligible(base({ convertedToLead: 1 }), T0)).toBe(false); // not read
    expect(isMissedCallEligible(base({ convertedToLead: 1, capturedNothing: false }), T0)).toBe(false);
    expect(isMissedCallEligible(base({ convertedToLead: 1, capturedNothing: true }), T0)).toBe(true);
    // proof never overrides the other rules
    expect(isMissedCallEligible(base({ convertedToLead: 1, capturedNothing: true, leadId: 3 }), T0)).toBe(false);
    expect(isMissedCallEligible(base({ convertedToLead: 1, capturedNothing: true, recoveryAlreadyStamped: true }), T0)).toBe(false);
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

describe("processMissedCallRecovery · tool-reaching callers", () => {
  const ORIGINAL_SEND = process.env.MISSED_CALL_RECOVERY_SEND;
  const NOW = new Date("2026-10-02T18:00:00Z"); // 14:00 Cleveland — inside 9-17
  const call = (vapiCallId: string, convertedToLead: number) => ({
    id: vapiCallId.length, vapiCallId, phoneNumber: `21655501${vapiCallId.length}0`, durationSeconds: 40,
    convertedToLead, leadId: null, callbackId: null, metadata: null,
    createdAt: new Date(NOW.getTime() - 90 * MIN),
  });

  beforeEach(() => {
    // Only Date is faked: this path has no timers to race.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.MISSED_CALL_RECOVERY_SEND = "1";
    h.callRows = [];
    h.evidence = {};
    h.evidenceCalls = [];
    h.sent = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_SEND === undefined) delete process.env.MISSED_CALL_RECOVERY_SEND;
    else process.env.MISSED_CALL_RECOVERY_SEND = ORIGINAL_SEND;
  });

  it("texts a tool-reaching caller only when the evidence read proves nothing was captured", async () => {
    h.callRows = [
      call("plain", 0), // never reached a tool → eligible, no evidence read needed
      call("tool-nothing", 1), // tire-price lookup, nothing saved → eligible
      call("tool-readfail", 1), // evidence read failed ({}) → unknown → skipped
      call("tool-arrival", 1), // bookSlot recorded a walk-in commitment → skipped
      call("tool-callbackrow", 1), // escalate wrote a callback_requests row naming the call → skipped
    ];
    const nothing = { reachedTool: true, leadId: null, callbackId: null, existingCallbackForCall: false, hasExpectedArrival: false };
    h.evidence = {
      "tool-nothing": nothing,
      "tool-arrival": { ...nothing, hasExpectedArrival: true },
      "tool-callbackrow": { ...nothing, existingCallbackForCall: true },
    };

    const out = await processMissedCallRecovery();

    expect(h.sent.sort()).toEqual(["plain", "tool-nothing"]);
    expect(out).toMatchObject({ shadow: false, candidates: 2, recordsProcessed: 2 });
    // the evidence read runs for tool-reaching calls only
    expect(h.evidenceCalls.sort()).toEqual(["tool-arrival", "tool-callbackrow", "tool-nothing", "tool-readfail"]);
  });
});
