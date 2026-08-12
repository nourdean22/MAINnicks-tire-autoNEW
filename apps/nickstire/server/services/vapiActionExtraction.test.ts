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
import { describe, expect, it } from "vitest";
import {
  ACTIONABLE_OUTCOMES,
  buildExtractionPrompt,
  buildProposalInputs,
  parseExtraction,
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

describe("prompt contract", () => {
  it("forbids invented contact info and demands the empty-array escape", () => {
    const prompt = buildExtractionPrompt();
    expect(prompt).toContain("NEVER invent contact information");
    expect(prompt).toContain("empty actions array");
    expect(prompt).toContain("create_callback");
    expect(prompt).toContain("create_booking_request");
  });
});
