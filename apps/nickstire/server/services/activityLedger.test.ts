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
