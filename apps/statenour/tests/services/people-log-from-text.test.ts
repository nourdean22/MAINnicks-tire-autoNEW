/**
 * The ledger's one-line grammar (shared by ⌘K and Telegram /log) and the
 * server half that turns a typed line into a ledger row · 2026-09-16.
 *
 * The parser had no test while it lived inside the ⌘K component; it moved to
 * lib/services/people so the phone and the desktop parse the same line the
 * same way, and so a server route can use it without a client import.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ resolve: vi.fn(), record: vi.fn(), sameName: vi.fn() }));
vi.mock("@/lib/brain/person-profile-fuzzy", () => ({ resolvePersonByName: m.resolve }));
vi.mock("@/lib/services/people/record-interaction", () => ({ recordInteraction: m.record }));
vi.mock("@/lib/prisma", () => ({ prisma: { personProfile: { findMany: m.sameName } } }));

import { parseLedgerQuery } from "@/lib/services/people/parse-ledger-query";
import { logInteractionFromText, resolveLedgerPerson } from "@/lib/services/people/log-from-text";

describe("parseLedgerQuery — <name> <+n|-n> [note]", () => {
  it("parses a single-word name, a signed amount and a note", () => {
    expect(parseLedgerQuery("dania +5 coffee, talked about the move")).toEqual({
      rawName: "dania",
      amount: 5,
      note: "coffee, talked about the move",
    });
  });

  it("joins every token before the amount into the name and defaults an empty note", () => {
    expect(parseLedgerQuery("mary jane -3")).toEqual({ rawName: "mary jane", amount: -3, note: "manual log" });
  });

  it("returns null without a signed amount, with the amount first, or beyond ±100", () => {
    expect(parseLedgerQuery("dania")).toBeNull();
    expect(parseLedgerQuery("dania 5 coffee")).toBeNull();
    expect(parseLedgerQuery("+5 dania")).toBeNull();
    expect(parseLedgerQuery("dania +500")).toBeNull();
  });
});

describe("logInteractionFromText", () => {
  beforeEach(() => {
    m.resolve.mockReset();
    m.record.mockReset();
    m.sameName.mockReset();
    m.sameName.mockResolvedValue([{ id: "p1", name: "Dania" }]);
  });

  it("returns usage for an unparseable line and touches nothing", async () => {
    expect(await logInteractionFromText("dania", "telegram")).toEqual({ kind: "usage" });
    expect(m.resolve).not.toHaveBeenCalled();
    expect(m.record).not.toHaveBeenCalled();
  });

  it("a pronoun is rejected and an unknown name is reported — never created, never logged", async () => {
    m.resolve.mockResolvedValueOnce({ person: null, matched: false, matchTier: "rejected_nonname" });
    expect(await logInteractionFromText("her +5 coffee", "telegram")).toEqual({ kind: "rejected_name", name: "her" });

    m.resolve.mockResolvedValueOnce({ person: null, matched: false, matchTier: "no_match" });
    expect(await logInteractionFromText("zorblax +5 coffee", "telegram")).toEqual({ kind: "no_match", name: "zorblax" });

    for (const call of m.resolve.mock.calls) {
      expect(call[1]).toEqual({ createIfMissing: false });
    }
    expect(m.record).not.toHaveBeenCalled();
  });

  it("a resolved name writes through the seam with the surface as source", async () => {
    m.resolve.mockResolvedValueOnce({ person: { id: "p1", name: "Dania" }, matched: true, matchTier: "case_insensitive" });
    const recorded = { ledgerId: "L1", personId: "p1", personName: "Dania", amount: 5, note: "coffee", source: "telegram", at: new Date(), lastInteraction: new Date(), interactionCount: 4 };
    m.record.mockResolvedValueOnce(recorded);

    const out = await logInteractionFromText("dania +5 coffee", "telegram");
    expect(m.record).toHaveBeenCalledWith({
      personId: "p1",
      amount: 5,
      note: "coffee",
      source: "telegram",
      metadata: { via: "telegram_command", matchTier: "case_insensitive" },
    });
    expect(out).toEqual({ kind: "logged", recorded, matchTier: "case_insensitive" });
  });
});

// 2026-11-03 · the resolver Nick's logPersonInteraction tool shares. A ledger write decides WHICH
// person row moves (claim-before-act): it never takes the first of two same-spelled names, and a
// typo-close match is a guess the strict caller must ask about.
describe("resolveLedgerPerson", () => {
  beforeEach(() => {
    m.resolve.mockReset();
    m.record.mockReset();
    m.sameName.mockReset();
  });

  it("two people spelled the same way (case aside) are ambiguous, with both as candidates; nothing logged", async () => {
    m.resolve.mockResolvedValue({ person: { id: "p1", name: "Mash" }, matched: true, matchTier: "case_insensitive" });
    m.sameName.mockResolvedValue([{ id: "p1", name: "Mash" }, { id: "p2", name: "MASH" }]);
    const want = {
      kind: "ambiguous",
      name: "mash",
      reason: "same_name",
      candidates: [{ id: "p1", name: "Mash" }, { id: "p2", name: "MASH" }],
    };
    expect(await resolveLedgerPerson("mash", { allowTypoMatch: false })).toEqual(want);
    expect(await logInteractionFromText("mash +5 counter", "telegram")).toEqual(want);
    expect(m.record).not.toHaveBeenCalled();
    // The read must be case-insensitive on the trimmed name: name is unique only case-sensitively,
    // so a case-sensitive read returns one row and the guard never fires.
    expect(m.sameName.mock.calls[0][0].where).toEqual({ name: { equals: "mash", mode: "insensitive" }, deletedAt: null });
  });

  it("a typo-close match is ambiguous for a strict caller and resolved for Telegram (which shows the name back)", async () => {
    m.resolve.mockResolvedValue({ person: { id: "p3", name: "Manny" }, matched: true, matchTier: "levenshtein" });
    expect(await resolveLedgerPerson("Many", { allowTypoMatch: false })).toEqual({
      kind: "ambiguous",
      name: "Many",
      reason: "typo_match",
      candidates: [{ id: "p3", name: "Manny" }],
    });
    expect(await resolveLedgerPerson("Many", { allowTypoMatch: true })).toEqual({
      kind: "resolved",
      person: { id: "p3", name: "Manny" },
      matchTier: "levenshtein",
    });
  });

  it("an exact name resolves without the same-name read", async () => {
    m.resolve.mockResolvedValue({ person: { id: "p1", name: "Mash" }, matched: true, matchTier: "exact" });
    expect(await resolveLedgerPerson("Mash", { allowTypoMatch: false })).toMatchObject({ kind: "resolved", person: { id: "p1" } });
    expect(m.sameName).not.toHaveBeenCalled();
  });
});
