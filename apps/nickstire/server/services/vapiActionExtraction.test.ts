/**
 * VAPI → proposals extraction (Phase 6 trust ladder).
 *
 * Mechanisms under test, all pure (no LLM, no db):
 *   1. the deterministic gate — spam / tech failures / walk-ins / short or
 *      phoneless calls never reach the LLM (classifyCall is the incumbent
 *      regex classifier and runs for real here);
 *   2. the parse contract — unknown shapes THROW, never default to acting;
 *   3. proposal mapping — the VERIFIED telephony number is the only phone a
 *      draft can carry, and the idempotency key is per (call, kind).
 */
import { describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../db", () => ({ getDb: async () => ({ execute }) }));

import {
  ACTIONABLE_OUTCOMES,
  buildExtractionPrompt,
  buildProposalInputs,
  dropAlreadyOwned,
  isOutboundCall,
  loadCallCaptureEvidence,
  parseExtraction,
  shopToday,
  shouldExtract,
  type CallMeta,
} from "./vapiActionExtraction";

const meta = (over: Partial<CallMeta> = {}): CallMeta => ({
  callId: "call-abc-123",
  transcript:
    "Caller: My brakes are grinding pretty badly. Can you have someone call me back this afternoon? Receptionist: Of course, we will.",
  summary: "Caller asked for a callback about grinding brakes.",
  customerName: "Jane Driver",
  customerPhone: "+12168620005",
  durationSeconds: 62,
  endedReason: "customer-ended-call",
  ...over,
});

describe("shouldExtract — the deterministic gate", () => {
  it("passes an explicit callback ask through as callback_needed", () => {
    expect(shouldExtract(meta())).toBe("callback_needed");
  });

  it("passes a tire availability ask through", () => {
    // Summary overridden too: classifyCall reads transcript + summary as one
    // text, so the default fixture's "callback" summary would win otherwise.
    const outcome = shouldExtract(
      meta({
        transcript:
          "Caller: Do you have any used tires in two twenty five sixty five R seventeen? Receptionist: Let me check on that for you.",
        summary: "Caller asked about used tire availability in a specific size.",
      }),
    );
    expect(outcome).toBe("tire_availability_intent");
  });

  it("never extracts spam, tech failures, or walk-in-directed calls", () => {
    expect(shouldExtract(meta({ transcript: "Caller: wrong number sorry about that, wrong number." }))).toBeNull();
    expect(shouldExtract(meta({ endedReason: "assistant-error" }))).toBeNull();
    expect(
      shouldExtract(
        meta({
          transcript:
            "Caller: My brakes are grinding. Receptionist: Just swing by the shop on Euclid today, first-come first-serve.",
        }),
      ),
    ).toBeNull();
  });

  it("never extracts without a verified telephony number", () => {
    expect(shouldExtract(meta({ customerPhone: null }))).toBeNull();
    expect(shouldExtract(meta({ customerPhone: "12" }))).toBeNull();
  });

  it("never extracts a trivial transcript", () => {
    expect(shouldExtract(meta({ transcript: "Hello? Anyone there?" }))).toBeNull();
  });

  it("never extracts an OUTBOUND call — that work already exists", () => {
    // Our confirmation / recovery calls carry the same reschedule-and-callback
    // language an inbound ask does, and classifyCall has no direction sense.
    expect(shouldExtract(meta({ callType: "outboundPhoneCall" }))).toBeNull();
    expect(
      shouldExtract(
        meta({
          callType: "outboundPhoneCall",
          transcript:
            "Receptionist: Just confirming Friday. Caller: Actually can you call me back, I need to reschedule that.",
          summary: "Outbound confirmation — caller asked to reschedule.",
        }),
      ),
    ).toBeNull();
  });

  it("still extracts inbound, and treats an ABSENT type as inbound", () => {
    expect(shouldExtract(meta({ callType: "inboundPhoneCall" }))).toBe("callback_needed");
    // Deliberate default: a dropped field must not silently disable the feature.
    expect(shouldExtract(meta({ callType: null }))).toBe("callback_needed");
    expect(shouldExtract(meta({ callType: undefined }))).toBe("callback_needed");
  });

  it("actionable set stays reviewer-facing only — handled calls are excluded", () => {
    expect(ACTIONABLE_OUTCOMES).not.toContain("hard_conversion");
    expect(ACTIONABLE_OUTCOMES).not.toContain("human_handoff");
    expect(ACTIONABLE_OUTCOMES).not.toContain("walk_in_directed");
  });
});

describe("parseExtraction — throws, never defaults to acting", () => {
  it("parses a valid reply and clamps confidence", () => {
    const actions = parseExtraction(
      '{"actions":[{"kind":"create_callback","name":"Jane","reason":"call back about brakes","service":null,"preferredDate":null,"confidence":150}]}',
    );
    expect(actions).toEqual([
      {
        kind: "create_callback",
        name: "Jane",
        reason: "call back about brakes",
        service: null,
        preferredDate: null,
        confidence: 100,
      },
    ]);
  });

  it("throws on non-JSON, unknown kinds, and missing reasons", () => {
    expect(() => parseExtraction("I could not determine any actions.")).toThrow(/no JSON/);
    expect(() =>
      parseExtraction('{"actions":[{"kind":"send_sms","reason":"text them","confidence":80}]}'),
    ).toThrow(/unknown action kind/);
    expect(() =>
      parseExtraction('{"actions":[{"kind":"create_callback","reason":"","confidence":80}]}'),
    ).toThrow(/no reason/);
  });

  it("an empty actions array is a good answer, not an error", () => {
    expect(parseExtraction('{"actions":[]}')).toEqual([]);
  });

  it("drops duplicate kinds and rejects malformed dates", () => {
    const actions = parseExtraction(
      '{"actions":[{"kind":"create_callback","reason":"first","confidence":90},{"kind":"create_callback","reason":"second","confidence":70},{"kind":"create_booking_request","reason":"bring it in","preferredDate":"next tuesday","confidence":60}]}',
    );
    expect(actions).toHaveLength(2);
    expect(actions[0].reason).toBe("first");
    expect(actions[1]).toMatchObject({ kind: "create_booking_request", preferredDate: null });
  });

  it('treats the literal string "null" name as no name', () => {
    const [a] = parseExtraction(
      '{"actions":[{"kind":"create_callback","name":"null","reason":"call back","confidence":50}]}',
    );
    expect(a.name).toBeNull();
  });
});

describe("buildProposalInputs — verified phone, per-(call,kind) idempotency", () => {
  const actions = parseExtraction(
    '{"actions":[{"kind":"create_callback","name":null,"reason":"call back about brakes","confidence":82},{"kind":"create_booking_request","reason":"bring it in Friday","service":"brake inspection","preferredDate":"2026-08-14","confidence":74}]}',
  );

  it("injects ONLY the verified telephony number and falls back to the call's name", () => {
    const inputs = buildProposalInputs(actions, meta(), "callback_needed");
    for (const input of inputs) {
      expect((input.payload as { phone: string }).phone).toBe("+12168620005");
    }
    expect((inputs[0].payload as { name: string }).name).toBe("Jane Driver");
  });

  it("keys idempotency per (call, kind) and stamps nick_receptionist provenance", () => {
    const inputs = buildProposalInputs(actions, meta(), "callback_needed");
    expect(inputs.map((i) => i.idempotencyKey)).toEqual([
      "vapi:call-abc-123:create_callback",
      "vapi:call-abc-123:create_booking_request",
    ]);
    for (const input of inputs) {
      expect(input.source).toBe("nick_receptionist");
      expect(input.entityType).toBe("vapi_call");
      expect((input.context as { vapiCallId: string }).vapiCallId).toBe("call-abc-123");
    }
  });

  it("booking payloads carry service + preferredDate; callbacks carry the reason", () => {
    const inputs = buildProposalInputs(actions, meta(), "callback_needed");
    expect(inputs[0].payload).toMatchObject({ reason: "call back about brakes", sourcePage: "vapi-call" });
    expect(inputs[1].payload).toMatchObject({
      service: "brake inspection",
      preferredDate: "2026-08-14",
      note: "bring it in Friday",
    });
  });

  it("confidence rides the proposal for the reviewer's low-confidence flag", () => {
    const inputs = buildProposalInputs(actions, meta(), "callback_needed");
    expect(inputs.map((i) => i.confidence)).toEqual([82, 74]);
  });
});

describe("isOutboundCall", () => {
  it("matches VAPI's outbound types and nothing else", () => {
    expect(isOutboundCall("outboundPhoneCall")).toBe(true);
    expect(isOutboundCall("OUTBOUND")).toBe(true);
    expect(isOutboundCall("inboundPhoneCall")).toBe(false);
    expect(isOutboundCall(null)).toBe(false);
    expect(isOutboundCall(undefined)).toBe(false);
  });
});

describe("prompt contract", () => {
  it("forbids invented contact info and demands the empty-array escape", () => {
    const prompt = buildExtractionPrompt("2026-10-02");
    expect(prompt).toContain("NEVER invent contact information");
    expect(prompt).toContain("empty actions array");
    expect(prompt).toContain("create_callback");
    expect(prompt).toContain("create_booking_request");
  });
});

/**
 * CAPTURE-AWARE GATE (2026-10-02). Production: 44 drafts, 38 rejected by a
 * human. Two duplicate shapes drove it — a callback draft for a call whose
 * scheduleCallback/escalate ALREADY wrote callback_requests, and a booking
 * draft for a walk-in caller bookSlot already recorded as an expected arrival
 * (and told "no appointment was booked").
 */
describe("capture-aware gate — a call a tool already captured makes no draft", () => {
  it("a persisted lead/callback/booking id short-circuits extraction (hard_conversion)", () => {
    expect(shouldExtract(meta())).toBe("callback_needed");
    expect(shouldExtract(meta({ callbackId: 41 }))).toBeNull();
    expect(shouldExtract(meta({ leadId: 9 }))).toBeNull();
    expect(shouldExtract(meta({ bookingId: 3 }))).toBeNull();
  });

  it("skips the LLM entirely when BOTH kinds are already owned", () => {
    expect(shouldExtract(meta({ existingCallbackForCall: true }))).toBe("callback_needed");
    expect(shouldExtract(meta({ existingCallbackForCall: true, hasExpectedArrival: true }))).toBeNull();
  });

  const both = parseExtraction(
    '{"actions":[{"kind":"create_callback","reason":"call me back","confidence":90},{"kind":"create_booking_request","reason":"bring it in Friday","service":"brakes","confidence":80}]}',
  );

  it("drops the callback draft when a callback row already names this call", () => {
    const { kept, dropped } = dropAlreadyOwned(both, meta({ existingCallbackForCall: true }));
    expect(kept.map((a) => a.kind)).toEqual(["create_booking_request"]);
    expect(dropped).toEqual([{ kind: "create_callback", reason: "callback_request_exists_for_call" }]);
  });

  it("drops the booking draft when bookSlot already recorded an expected arrival", () => {
    const { kept, dropped } = dropAlreadyOwned(both, meta({ hasExpectedArrival: true }));
    expect(kept.map((a) => a.kind)).toEqual(["create_callback"]);
    expect(dropped).toEqual([{ kind: "create_booking_request", reason: "expected_arrival_exists_for_call" }]);
  });

  it("keeps everything when nothing was captured", () => {
    expect(dropAlreadyOwned(both, meta()).kept).toHaveLength(2);
  });
});

describe("dates resolve against TODAY in shop time", () => {
  it("shopToday reports the America/New_York calendar day, not UTC", () => {
    // 2026-10-03 02:30 UTC is still Oct 2 (22:30 EDT) in Cleveland.
    expect(shopToday(new Date("2026-10-03T02:30:00Z"))).toBe("2026-10-02");
  });

  it("the prompt states today's date and weekday and forbids past dates", () => {
    const prompt = buildExtractionPrompt("2026-10-02");
    expect(prompt).toContain("Today is Friday, 2026-10-02");
    expect(prompt).toMatch(/never a past date/i);
  });

  it("parseExtraction drops a preferredDate before today, keeps today and later", () => {
    const raw = (d: string) =>
      `{"actions":[{"kind":"create_booking_request","reason":"bring it in","preferredDate":"${d}","confidence":70}]}`;
    expect(parseExtraction(raw("2026-10-01"), "2026-10-02")[0].preferredDate).toBeNull();
    expect(parseExtraction(raw("2026-10-02"), "2026-10-02")[0].preferredDate).toBe("2026-10-02");
    expect(parseExtraction(raw("2026-10-09"), "2026-10-02")[0].preferredDate).toBe("2026-10-09");
  });
});

describe("loadCallCaptureEvidence — one bounded read, fails open", () => {
  it("maps the row: positive ids, tool engagement, and both existence flags", async () => {
    execute.mockResolvedValueOnce([[{ leadId: null, callbackId: 41, convertedToLead: 1, hasCallback: 1, hasArrival: 0 }], []]);
    await expect(loadCallCaptureEvidence("call-abc-123")).resolves.toEqual({
      leadId: null,
      callbackId: 41,
      reachedTool: true,
      existingCallbackForCall: true,
      hasExpectedArrival: false,
    });
  });

  it("a missing log row reads as 'nothing captured', not as record #0", async () => {
    execute.mockResolvedValueOnce([[{ leadId: null, callbackId: 0, convertedToLead: null, hasCallback: 0, hasArrival: "1" }], []]);
    const ev = await loadCallCaptureEvidence("call-abc-123");
    expect(ev.callbackId).toBeNull();
    expect(ev.reachedTool).toBe(false);
    expect(ev.hasExpectedArrival).toBe(true);
  });

  it("a failed read returns {} so the gate behaves as before — never as 'captured'", async () => {
    execute.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await expect(loadCallCaptureEvidence("call-abc-123")).resolves.toEqual({});
  });
});
