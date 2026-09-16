/**
 * person.* agent actions · 2026-09-16.
 *
 * Two claims:
 *   · person.update is an EDIT, not a contact — it never touches
 *     lastInteraction / interactionCount. Before this wave every update from
 *     Nick bumped both with no ledger row behind it (measured on Neon:
 *     counters summed to 191 against 23 ledger rows ever).
 *   · person.logInteraction is the contact path — it resolves an EXISTING
 *     person (never creating one) and writes through the ledger seam with
 *     source "chat", a clamped amount, and a receipt the tool card can render.
 *
 * Positive control (run before the fix): the first test goes red because the
 * update's data carries interactionCount + lastInteraction; the
 * logInteraction tests fail on a missing export.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  personFindUnique: vi.fn(),
  personUpdate: vi.fn(),
  resolve: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: { findUnique: m.personFindUnique, update: m.personUpdate },
    brainMemory: { create: vi.fn(async () => ({ id: "mem" })) },
  },
}));
vi.mock("@/lib/brain/person-profile-fuzzy", () => ({ resolvePersonByName: m.resolve }));
vi.mock("@/lib/brain/person-roles", () => ({ isPersonRole: (r: string) => ["friend", "mentor", "family"].includes(r) }));
vi.mock("@/lib/services/people/record-interaction", () => ({ recordInteraction: m.record }));

import { handlePersonLogInteraction, handlePersonUpdate } from "@/lib/ai/agent-actions/person-actions";

const MATCHED = { person: { id: "p1", name: "Dania" }, matched: true, matchTier: "exact" as const };

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.personFindUnique.mockResolvedValue({ role: "friend", trustScore: 0.5 });
  m.personUpdate.mockResolvedValue({ id: "p1" });
});

describe("person.update — an edit is not a contact", () => {
  it("writes the relationship text and NOTHING else to the interaction fields", async () => {
    m.resolve.mockResolvedValueOnce(MATCHED);
    const res = await handlePersonUpdate({ name: "Dania", relationship: "sister of a customer" }, "person.update");
    expect(res.success).toBe(true);
    expect(m.personUpdate).toHaveBeenCalledTimes(1);
    expect(m.personUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { relationship: "sister of a customer" },
    });
    expect(m.record).not.toHaveBeenCalled();
  });

  it("a pure role proposal writes only the pending classification — no empty immediate update", async () => {
    m.resolve.mockResolvedValueOnce(MATCHED);
    const res = await handlePersonUpdate({ name: "Dania", role: "mentor" }, "person.update");
    expect(res.success).toBe(true);
    expect(m.personUpdate).toHaveBeenCalledTimes(1);
    const data = m.personUpdate.mock.calls[0][0].data as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(["pendingClassification"]);
    expect(data).not.toHaveProperty("interactionCount");
    expect(data).not.toHaveProperty("lastInteraction");
  });
});

describe("person.logInteraction — the contact path", () => {
  it("resolves an existing person and writes through the seam: source chat, via nick_action, amount clamped to ±25", async () => {
    m.resolve.mockResolvedValueOnce(MATCHED);
    m.record.mockResolvedValueOnce({
      ledgerId: "L1",
      personId: "p1",
      personName: "Dania",
      amount: 25,
      note: "dinner, talked about the move",
      source: "chat",
      at: new Date("2026-09-16T01:00:00Z"),
      lastInteraction: new Date("2026-09-16T01:00:00Z"),
      interactionCount: 4,
    });

    const res = await handlePersonLogInteraction(
      { name: "Dania", note: "dinner, talked about the move", amount: 40, kind: "in_person" },
      "person.logInteraction",
    );

    expect(m.resolve).toHaveBeenCalledWith("Dania", { createIfMissing: false });
    expect(m.record).toHaveBeenCalledWith({
      personId: "p1",
      amount: 25,
      note: "dinner, talked about the move",
      source: "chat",
      metadata: { via: "nick_action", kind: "in_person", matchTier: "exact" },
    });
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({
      id: "p1",
      name: "Dania",
      ledgerId: "L1",
      amount: 25,
      kind: "in_person",
      interactionCount: 4,
      lastInteraction: "2026-09-16T01:00:00.000Z",
    });
  });

  it("defaults: amount 1, kind other, when Nick passes neither", async () => {
    m.resolve.mockResolvedValueOnce(MATCHED);
    m.record.mockResolvedValueOnce({ ledgerId: "L2", personId: "p1", personName: "Dania", amount: 1, note: "quick call", source: "chat", at: new Date(), lastInteraction: new Date(), interactionCount: 5 });
    await handlePersonLogInteraction({ name: "Dania", note: "quick call" }, "person.logInteraction");
    expect(m.record.mock.calls[0][0]).toMatchObject({ amount: 1, metadata: { kind: "other" } });
  });

  it("an unknown name is an ask-first error and a pronoun is rejected — nothing is written either way", async () => {
    m.resolve.mockResolvedValueOnce({ person: null, matched: false, matchTier: "no_match" });
    const unknown = await handlePersonLogInteraction({ name: "Zorblax", note: "coffee" }, "person.logInteraction");
    expect(unknown.success).toBe(false);
    expect(unknown.error).toMatch(/want me to add Zorblax/);

    m.resolve.mockResolvedValueOnce({ person: null, matched: false, matchTier: "rejected_nonname" });
    const pronoun = await handlePersonLogInteraction({ name: "her", note: "coffee" }, "person.logInteraction");
    expect(pronoun.success).toBe(false);
    expect(pronoun.error).toMatch(/not a real name/);

    expect(m.record).not.toHaveBeenCalled();
  });

  it("a missing note fails before resolving anyone", async () => {
    const res = await handlePersonLogInteraction({ name: "Dania" }, "person.logInteraction");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/needs a note/);
    expect(m.resolve).not.toHaveBeenCalled();
    expect(m.record).not.toHaveBeenCalled();
  });
});
