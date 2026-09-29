/**
 * Activity-ledger mechanisms (0110).
 *
 * Asserts the three mechanisms, not just their existence:
 *  1. actor derivation — the WHO-KIND attribution the audit table could not
 *     previously express;
 *  2. PII masking — phone/email values are reduced BEFORE landing in a row
 *     (PROTECTED-CORE rule 5);
 *  3. middleware flow — records exactly on success, never on failure, and a
 *     broken recorder/extractor can never break the wrapped mutation.
 *
 * No vi.mock: the recorder is injected through the LedgerSpec.record seam, so
 * the shared singleFork mock registry is never touched.
 */
import { describe, expect, it } from "vitest";
import {
  deriveActor,
  maskEmail,
  maskPhone,
  sanitizeSnapshot,
  scrubFreeText,
  withActivityLedger,
  type RecordActivityInput,
} from "./activityLedger";

describe("deriveActor", () => {
  it("classifies the voice-agent internal context as nick_receptionist", () => {
    expect(deriveActor({ isVoiceAgentInternal: true, user: null })).toEqual({
      actor: "nick-receptionist",
      actorType: "nick_receptionist",
    });
  });

  it("classifies a signed-in user as human_user, attributed by email first", () => {
    expect(deriveActor({ user: { email: "owner@nickstire.org", name: "Nick" } })).toEqual({
      actor: "owner@nickstire.org",
      actorType: "human_user",
    });
    expect(deriveActor({ user: { email: null, name: "Nick" } })).toEqual({
      actor: "Nick",
      actorType: "human_user",
    });
  });

  it("classifies an anonymous context as public", () => {
    expect(deriveActor({})).toEqual({ actor: "public", actorType: "public" });
    expect(deriveActor({ user: null })).toEqual({ actor: "public", actorType: "public" });
  });
});

describe("PII masking", () => {
  it("maskPhone keeps only the last four digits", () => {
    expect(maskPhone("(216) 862-0005")).toBe("•••0005");
    expect(maskPhone("12")).toBe("•••");
  });

  it("maskEmail keeps first char + domain", () => {
    expect(maskEmail("customer@example.com")).toBe("c•••@example.com");
    expect(maskEmail("not-an-email")).toBe("•••");
  });

  it("sanitizeSnapshot masks phone/email keys at any depth and preserves the rest", () => {
    const out = sanitizeSnapshot({
      name: "Jane Driver",
      phone: "2168620005",
      customerEmail: "jane@example.com",
      nested: { customerPhone: "216-555-1234", service: "brakes" },
      amounts: [{ estimatedAmount: "450" }],
    });
    expect(out).toEqual({
      name: "Jane Driver",
      phone: "•••0005",
      customerEmail: "j•••@example.com",
      nested: { customerPhone: "•••1234", service: "brakes" },
      amounts: [{ estimatedAmount: "450" }],
    });
  });

  it("sanitizeSnapshot passes null/undefined through as null", () => {
    expect(sanitizeSnapshot(null)).toBeNull();
    expect(sanitizeSnapshot(undefined)).toBeNull();
  });

  it("scrubs phone/email shapes EMBEDDED in free-text values (review finding)", () => {
    // A public visitor typing contact info into a symptom box must not land
    // verbatim in a ledger row — key-based masking alone cannot see this.
    const out = sanitizeSnapshot({
      symptom: "car makes a noise, call me at 216-555-1234 or jane.d@example.com thanks",
    });
    const symptom = (out as { symptom: string }).symptom;
    expect(symptom).not.toContain("216-555-1234");
    expect(symptom).not.toContain("jane.d@example.com");
    expect(symptom).toContain("•••1234");
    expect(symptom).toContain("j•••@example.com");
  });

  it("leaves benign numbers in free text alone — prices, years, sizes", () => {
    const out = sanitizeSnapshot({
      symptom: "2015 Honda, quoted $450 for 225/65R17 tires",
    });
    expect((out as { symptom: string }).symptom).toBe("2015 Honda, quoted $450 for 225/65R17 tires");
  });
});

// 2026-09-29 (review of #2782): the embedded-phone scrub read the digits of an
// ISO date as a phone number, so "2026-09-29 17:30:00" landed in every ledger
// row as "•••2917:30:00". Dates are shielded now. Guard-red-team: every phone
// shape below must still be masked, and each verdict stays locked here.
describe("PII masking · dates are not phone numbers", () => {
  const DATES_KEPT = [
    "2026-09-29",
    "2026-09-29 17:30:00",
    "2026-09-29T17:30:00.000Z",
    "2026-09-29T17:30:00Z",
    "2026-09-29T17:30:00-04:00",
    "2026-09-29T17:30",
    "decided 2026-09-29 17:30:00 by the owner",
  ];
  it.each(DATES_KEPT)("keeps %s intact", (text) => {
    expect(scrubFreeText(text)).toBe(text);
  });

  // Outputs pinned from the real function before the change; every one is unchanged.
  const PHONES_MASKED: Array<[string, string]> = [
    ["call 216-555-0123 please", "call •••0123 please"],
    ["call (216) 555-0123 please", "call (•••0123 please"],
    ["call 216.555.0123 please", "call •••0123 please"],
    ["call 2165550123 please", "call •••0123 please"],
    ["call +1 216 555 0123 please", "call •••0123 please"],
    ["call +1-216-555-0123 please", "call •••0123 please"],
    ["call 555-0123 please", "call •••0123 please"],
  ];
  it.each(PHONES_MASKED)("still masks %s", (text, masked) => {
    expect(scrubFreeText(text)).toBe(masked);
  });

  it("a phone written next to a date is masked, and the date is kept", () => {
    // Before, the two merged into one masked run: "text •••2026-09-29".
    expect(scrubFreeText("text 2165550123 2026-09-29")).toBe("text •••0123 2026-09-29");
    expect(scrubFreeText("on 2026-09-29 2165550123")).toBe("on 2026-09-29 •••0123");
    expect(scrubFreeText("5550123 2026-09-29T17:30:00Z")).toBe("•••0123 2026-09-29T17:30:00Z");
  });

  it("no real month and day, no shield: masked like any other run of digits", () => {
    expect(scrubFreeText("ref 2026-13-45")).toBe("ref •••1345");
    // Digits run on past the day, so it is not a date.
    expect(scrubFreeText("2026-09-292165550123")).toBe("2026-•••0123");
    // A year range is still masked. That loses readability, but it can never leak.
    expect(scrubFreeText("fits 2015-2019 Civic")).toBe("fits •••2019 Civic");
  });

  it("text that already carries the shield's private-use marker is scrubbed the old way", () => {
    expect(scrubFreeText(" 2026-09-29 2165550123")).toBe(" •••0929 •••0123");
  });

  it("CONSUMER: a timestamp in a ledger snapshot survives sanitizeSnapshot and parses back", () => {
    const out = sanitizeSnapshot({
      decidedAt: "2026-09-29 17:30:00",
      note: "approved at 2026-09-29T17:30:00.000Z, call 216-555-0123",
      customerPhone: "2165550123",
    }) as Record<string, string>;
    expect(out.decidedAt).toBe("2026-09-29 17:30:00");
    expect(Date.parse(out.decidedAt.replace(" ", "T") + "Z")).toBe(Date.parse("2026-09-29T17:30:00Z"));
    expect(out.note).toBe("approved at 2026-09-29T17:30:00.000Z, call •••0123");
    expect(out.customerPhone).toBe("•••0123");
  });
});

describe("withActivityLedger middleware flow", () => {
  const okResult = { ok: true as const, data: { leadId: 42 } };

  function collector() {
    const calls: RecordActivityInput[] = [];
    return {
      calls,
      record: async (input: RecordActivityInput) => {
        calls.push(input);
      },
    };
  }

  it("records one attributed row after a successful mutation", async () => {
    const { calls, record } = collector();
    const result = await withActivityLedger(
      {
        ctx: { user: { email: "owner@nickstire.org", name: null } },
        input: { name: "Jane", phone: "2168620005", source: "popup" },
        next: async () => okResult,
      },
      {
        action: "lead.created",
        entityType: "lead",
        entityId: (_i, data) => (data as { leadId: number }).leadId,
        after: (input) => ({ ...(input as Record<string, unknown>) }),
        record,
      },
    );

    expect(result).toBe(okResult);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      action: "lead.created",
      entityType: "lead",
      entityId: 42,
      status: "executed",
      actor: { actor: "owner@nickstire.org", actorType: "human_user" },
    });
    // Raw snapshot reaches the recorder; masking is recordActivity's job and
    // is asserted separately above (sanitizeSnapshot) — this pin documents the
    // seam boundary so a refactor cannot silently double- or never-mask.
    expect(calls[0].after).toMatchObject({ phone: "2168620005" });
  });

  it("does not record when the mutation failed", async () => {
    const { calls, record } = collector();
    const failed = { ok: false as const, error: new Error("nope") };
    const result = await withActivityLedger(
      { ctx: {}, input: {}, next: async () => failed },
      { action: "lead.created", entityType: "lead", record },
    );
    expect(result).toBe(failed);
    expect(calls).toHaveLength(0);
  });

  it("returns the mutation result even when the recorder throws", async () => {
    const result = await withActivityLedger(
      { ctx: {}, input: {}, next: async () => okResult },
      {
        action: "lead.created",
        entityType: "lead",
        record: async () => {
          throw new Error("ledger down");
        },
      },
    );
    expect(result).toBe(okResult);
  });

  it("returns the mutation result even when an extractor throws", async () => {
    const { calls, record } = collector();
    const result = await withActivityLedger(
      { ctx: {}, input: {}, next: async () => okResult },
      {
        action: "lead.created",
        entityType: "lead",
        entityId: () => {
          throw new Error("bad extractor");
        },
        record,
      },
    );
    expect(result).toBe(okResult);
    expect(calls).toHaveLength(0);
  });
});
