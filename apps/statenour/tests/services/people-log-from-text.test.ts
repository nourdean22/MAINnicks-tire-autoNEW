/**
 * The ledger's one-line grammar (shared by ⌘K and Telegram /log) and the
 * server half that turns a typed line into a ledger row · 2026-09-16.
 *
 * The parser had no test while it lived inside the ⌘K component; it moved to
 * lib/services/people so the phone and the desktop parse the same line the
 * same way, and so a server route can use it without a client import.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ resolve: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/brain/person-profile-fuzzy", () => ({ resolvePersonByName: m.resolve }));
vi.mock("@/lib/services/people/record-interaction", () => ({ recordInteraction: m.record }));

import { parseLedgerQuery } from "@/lib/services/people/parse-ledger-query";
import { logInteractionFromText } from "@/lib/services/people/log-from-text";

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
