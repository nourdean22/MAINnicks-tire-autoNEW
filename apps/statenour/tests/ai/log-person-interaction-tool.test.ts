/**
 * tests/ai/log-person-interaction-tool.test.ts · 2026-11-03
 *
 * logPersonInteraction decides WHICH person row moves, so it is a
 * claim-before-act shape: it writes by the id it resolved, never by a name it
 * guessed. Driven through the real tool and the real resolveLedgerPerson;
 * the fuzzy chain, the same-name read and the ledger seam are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ resolve: vi.fn(), sameName: vi.fn(), record: vi.fn(), recordError: vi.fn() }));

vi.mock("@/lib/brain/person-profile-fuzzy", () => ({ resolvePersonByName: m.resolve }));
vi.mock("@/lib/services/people/record-interaction", () => ({ recordInteraction: m.record }));
vi.mock("@/lib/prisma", () => ({ prisma: { personProfile: { findMany: m.sameName } } }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: m.recordError }));

import { tasksTools } from "@/lib/ai/tools/tasks";

type Executable = { execute: (args: unknown, opts?: unknown) => Promise<Record<string, any>> };
const run = (args: unknown) => (tasksTools as unknown as Record<string, Executable>).logPersonInteraction.execute(args, {});
const recorded = (personId: string, personName: string) => ({
  ledgerId: "L1", personId, personName, amount: 20, note: "covered the counter", source: "chat",
  at: new Date(), lastInteraction: new Date(), interactionCount: 9,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.sameName.mockResolvedValue([]);
});

describe("logPersonInteraction", () => {
  it("an exact name writes one chat row by the resolved id", async () => {
    m.resolve.mockResolvedValue({ person: { id: "p-mash", name: "Mash" }, matched: true, matchTier: "exact" });
    m.record.mockResolvedValue(recorded("p-mash", "Mash"));
    const out = await run({ personQuery: "Mash", amount: 20, note: "covered the counter" });
    expect(m.resolve).toHaveBeenCalledWith("Mash", { createIfMissing: false });
    expect(m.record).toHaveBeenCalledWith({
      personId: "p-mash",
      amount: 20,
      note: "covered the counter",
      source: "chat",
      metadata: { via: "chat_tool", matchTier: "exact" },
    });
    expect(out).toMatchObject({ logged: true, person: "Mash", personId: "p-mash", interactionCount: 9 });
  });

  it("a typo-close name is never written: ambiguous, with the candidate to ask about", async () => {
    m.resolve.mockResolvedValue({ person: { id: "p-manny", name: "Manny" }, matched: true, matchTier: "levenshtein" });
    const out = await run({ personQuery: "Many", amount: 5 });
    expect(m.record).not.toHaveBeenCalled();
    expect(out).toMatchObject({ logged: false, kind: "ambiguous", reason: "typo_match", candidates: [{ personId: "p-manny", name: "Manny" }] });
    expect(out.say).toMatch(/Manny/);
  });

  it("after he picks, the candidate's personId writes that row; an id that is not a candidate writes nothing", async () => {
    m.resolve.mockResolvedValue({ person: { id: "p1", name: "Mash" }, matched: true, matchTier: "case_insensitive" });
    m.sameName.mockResolvedValue([{ id: "p1", name: "Mash" }, { id: "p2", name: "MASH" }]);
    m.record.mockResolvedValue(recorded("p2", "MASH"));

    const picked = await run({ personQuery: "mash", personId: "p2", amount: 20, note: "covered the counter" });
    expect(m.record).toHaveBeenCalledTimes(1);
    expect(m.record.mock.calls[0][0]).toMatchObject({ personId: "p2", metadata: { via: "chat_tool", matchTier: "picked_candidate" } });
    expect(picked.logged).toBe(true);

    m.record.mockClear();
    const stranger = await run({ personQuery: "mash", personId: "p-someone-else", amount: 20 });
    expect(m.record).not.toHaveBeenCalled();
    expect(stranger).toMatchObject({ logged: false, kind: "ambiguous" });
    expect(stranger.say).toMatch(/not one of the candidates/);
  });

  it("a personId never overrides a name that resolved to one person", async () => {
    m.resolve.mockResolvedValue({ person: { id: "p-mash", name: "Mash" }, matched: true, matchTier: "exact" });
    m.record.mockResolvedValue(recorded("p-mash", "Mash"));
    await run({ personQuery: "Mash", personId: "p-other", amount: 1 });
    expect(m.record.mock.calls[0][0].personId).toBe("p-mash");
  });

  it("no_match and a pronoun write nothing and say why", async () => {
    m.resolve.mockResolvedValueOnce({ person: null, matched: false, matchTier: "no_match" });
    expect(await run({ personQuery: "Zorblax", amount: 5 })).toMatchObject({ logged: false, kind: "no_match" });
    m.resolve.mockResolvedValueOnce({ person: null, matched: false, matchTier: "rejected_nonname" });
    expect(await run({ personQuery: "her", amount: 5 })).toMatchObject({ logged: false, kind: "rejected_name" });
    expect(m.record).not.toHaveBeenCalled();
  });

  it("an empty note is the grammar's default, never an empty ledger row", async () => {
    m.resolve.mockResolvedValue({ person: { id: "p-mash", name: "Mash" }, matched: true, matchTier: "exact" });
    m.record.mockResolvedValue(recorded("p-mash", "Mash"));
    await run({ personQuery: "Mash", amount: 3, note: "   " });
    expect(m.record.mock.calls[0][0].note).toBe("manual log");
  });

  it("a failed write is recorded and reported as not logged", async () => {
    m.resolve.mockResolvedValue({ person: { id: "p-mash", name: "Mash" }, matched: true, matchTier: "exact" });
    m.record.mockRejectedValue(new Error("db down"));
    const out = await run({ personQuery: "Mash", amount: 3 });
    expect(out.logged).toBe(false);
    expect(out.error).toMatch(/nothing was logged/);
    expect(m.recordError).toHaveBeenCalledWith("ai:tool-exec", expect.any(Error), { op: "logPersonInteraction" });
  });
});
