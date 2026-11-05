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
  editNicknames: vi.fn(),
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
vi.mock("@/lib/services/people/nicknames", () => ({ editNicknames: m.editNicknames }));

import { Prisma } from "@prisma/client";
import { handlePersonCreate, handlePersonLogInteraction, handlePersonUpdate } from "@/lib/ai/agent-actions/person-actions";

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

  // W8b (audit B flagged): Nick's role proposal lands ON the slot, it does not replace a waiting cadence proposal.
  it("a role proposal keeps the cadence proposal already parked in the slot", async () => {
    m.resolve.mockResolvedValueOnce(MATCHED);
    m.personFindUnique.mockResolvedValue({
      role: "friend",
      trustScore: 0.5,
      pendingClassification: { cadenceDays: 14, basis: "default for friend", suggestedAt: "2026-10-30" },
    });
    await handlePersonUpdate({ name: "Dania", role: "mentor" }, "person.update");
    const pc = m.personUpdate.mock.calls[0][0].data.pendingClassification as Record<string, unknown>;
    expect(pc).toMatchObject({ cadenceDays: 14, cadenceBasis: "default for friend", role: "mentor", basis: "nick_agent person.update" });
    expect(m.personFindUnique.mock.calls[0][0].select.pendingClassification).toBe(true);
  });
});

describe("person.update — the proposal slot (manager round 1, item 7d)", () => {
  const parked = { role: "friend", trustScore: 0.5, pendingClassification: { role: null, leverageNotes: "Ask her about the lease", trustAdjustment: 0.05, basis: "ledger", suggestedAt: "2026-11-01" } };

  it("keeps a parked engine suggestion: Nick's role proposal lands beside its notes and trust change", async () => {
    m.resolve.mockResolvedValueOnce(MATCHED);
    m.personFindUnique.mockResolvedValue(parked);
    await handlePersonUpdate({ name: "Dania", role: "mentor" }, "person.update");
    const pc = m.personUpdate.mock.calls[0][0].data.pendingClassification as Record<string, unknown>;
    expect(pc).toMatchObject({ role: "mentor", leverageNotes: "Ask her about the lease", trustAdjustment: 0.05 });
  });

  it("is a compare-and-swap on the slot it read: no slot pins empty, a parked one pins itself", async () => {
    m.resolve.mockResolvedValueOnce(MATCHED);
    m.personFindUnique.mockResolvedValue(parked);
    await handlePersonUpdate({ name: "Dania", role: "mentor" }, "person.update");
    expect(m.personUpdate.mock.calls[0][0].where).toEqual({ id: "p1", pendingClassification: { equals: parked.pendingClassification } });
    m.personUpdate.mockClear();
    m.resolve.mockResolvedValueOnce(MATCHED);
    m.personFindUnique.mockResolvedValue({ role: "friend", trustScore: 0.5, pendingClassification: null });
    await handlePersonUpdate({ name: "Dania", role: "mentor" }, "person.update");
    expect(m.personUpdate.mock.calls[0][0].where).toEqual({ id: "p1", pendingClassification: { equals: Prisma.AnyNull } });
  });

  it("a lost swap (he answered the banner mid-call) is not a failure and does not claim a proposal", async () => {
    m.resolve.mockResolvedValueOnce(MATCHED);
    m.personFindUnique.mockResolvedValue(parked);
    m.personUpdate.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "P2025" }));
    const res = await handlePersonUpdate({ name: "Dania", role: "mentor" }, "person.update");
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({ pendingProposal: null });
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

describe("person.* · nicknames", () => {
  const SHARED = {
    person: null,
    matched: false,
    matchTier: "shared_nickname" as const,
    candidates: [
      { id: "y", name: "Yummah" },
      { id: "o", name: "Olivia" },
    ],
  };

  it("person.update adds and removes through the one writer and reports what landed", async () => {
    m.resolve.mockResolvedValueOnce({ ...MATCHED, person: { id: "y", name: "Yummah" } });
    m.editNicknames.mockResolvedValueOnce({ nicknames: ["mom"], dead: [] });
    const res = await handlePersonUpdate({ name: "Yummah", nicknames: ["mom"], removeNicknames: ["ma"] }, "person.update");
    expect(m.editNicknames).toHaveBeenCalledWith("y", { add: ["mom"], remove: ["ma"] }, { refuseTaken: true });
    expect((res.result as { applied: { nicknames?: string[] } }).applied.nicknames).toEqual(["mom"]);
    expect(res.success).toBe(true);
  });

  it("a bare string from the model counts as one nickname", async () => {
    m.resolve.mockResolvedValueOnce({ ...MATCHED, person: { id: "y", name: "Yummah" } });
    m.editNicknames.mockResolvedValueOnce({ nicknames: ["mom"], dead: [] });
    await handlePersonUpdate({ name: "Yummah", nicknames: "mom" }, "person.update");
    expect(m.editNicknames).toHaveBeenCalledWith("y", { add: ["mom"], remove: [] }, { refuseTaken: true });
  });

  it.each(["levenshtein", "jaro_winkler"] as const)("a %s match writes no nickname and nothing else", async (matchTier) => {
    m.resolve.mockResolvedValueOnce({ person: { id: "d", name: "Dania" }, matched: true, matchTier });
    const res = await handlePersonUpdate({ name: "Danai", nicknames: ["D"], relationship: "x" }, "person.update");
    expect(res.success).toBe(false);
    expect(res.error).toContain("Dania");
    expect(m.editNicknames).not.toHaveBeenCalled();
    expect(m.personUpdate).not.toHaveBeenCalled();
  });

  it.each(["exact", "case_insensitive", "nickname"] as const)("a %s match may write nicknames", async (matchTier) => {
    m.resolve.mockResolvedValueOnce({ person: { id: "y", name: "Yummah" }, matched: true, matchTier });
    m.editNicknames.mockResolvedValueOnce({ nicknames: ["mom"], dead: [] });
    expect((await handlePersonUpdate({ name: "yummah", nicknames: ["mom"] }, "person.update")).success).toBe(true);
  });

  it("a typo-close match with no nickname param still edits as before", async () => {
    m.resolve.mockResolvedValueOnce({ person: { id: "d", name: "Dania" }, matched: true, matchTier: "levenshtein" as const });
    expect((await handlePersonUpdate({ name: "Danai", relationship: "x" }, "person.update")).success).toBe(true);
    expect(m.personUpdate).toHaveBeenCalledTimes(1);
  });

  it("a refused nickname says why and leaves the rest of the update unwritten", async () => {
    m.resolve.mockResolvedValueOnce({ ...MATCHED, person: { id: "y", name: "Yummah" } });
    m.editNicknames.mockRejectedValueOnce(new Error('"boss" already points at Olivia.'));
    const res = await handlePersonUpdate({ name: "Yummah", nicknames: ["boss"], relationship: "x" }, "person.update");
    expect(res).toMatchObject({ success: false, error: '"boss" already points at Olivia.' });
    expect(m.personUpdate).not.toHaveBeenCalled();
  });

  it("no nickname params, no writer call", async () => {
    m.resolve.mockResolvedValueOnce(MATCHED);
    await handlePersonUpdate({ name: "Dania", relationship: "friend" }, "person.update");
    expect(m.editNicknames).not.toHaveBeenCalled();
  });

  it("says when a saved nickname links nobody, so Nick does not claim it works", async () => {
    m.resolve.mockResolvedValueOnce({ ...MATCHED, person: { id: "y", name: "Yummah" } });
    m.editNicknames.mockResolvedValueOnce({ nicknames: ["mom"], dead: ["mom"] });
    const res = await handlePersonUpdate({ name: "Yummah", nicknames: ["mom"] }, "person.update");
    expect((res.result as { nicknamesLinkingNobody?: string[] }).nicknamesLinkingNobody).toEqual(["mom"]);
  });

  it("a shared nickname asks which person, on all three actions, and writes nothing", async () => {
    m.resolve.mockResolvedValue(SHARED);
    for (const out of [
      await handlePersonUpdate({ name: "mom", relationship: "x" }, "person.update"),
      await handlePersonCreate({ name: "mom" }, "person.create"),
      await handlePersonLogInteraction({ name: "mom", note: "called" }, "person.logInteraction"),
    ]) {
      expect(out.success).toBe(false);
      expect(out.error).toContain("Yummah");
      expect(out.error).toContain("Olivia");
    }
    expect(m.personUpdate).not.toHaveBeenCalled();
    expect(m.record).not.toHaveBeenCalled();
  });
});
