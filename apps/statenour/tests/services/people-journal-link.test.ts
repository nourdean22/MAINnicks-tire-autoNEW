/**
 * W4 (job 2026-11-02-nour-os-interconnect) · journal entries carry person ids.
 *
 * "talked to Dania about the move" must reach Dania: the entry stores her id and ONE contact row lands in her ledger
 * through the one writer. The gate is the point of this file: a name the resolver cannot pin to exactly one person
 * writes nothing (no id, no row), because a contact logged on the wrong person is worse than a missed one.
 *
 * The REAL fuzzy resolver runs here (lib/brain/person-profile-fuzzy.ts) over a mocked people table, so the tier the
 * gate sees is the tier production would return. Only the ledger writer is mocked; its own window semantics are
 * pinned in tests/services/people-record-interaction.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type P = { id: string; name: string; deletedAt?: Date | null };
const h = vi.hoisted(() => {
  const people: P[] = [];
  const ci = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  // The fake honours deletedAt the way Postgres would: a query that omits the filter sees soft-deleted rows too.
  const live = (where: { deletedAt?: null }) => people.filter((p) => !("deletedAt" in where) || !p.deletedAt);
  return {
    people,
    findFirst: vi.fn(async ({ where }: { where: { name: string | { equals: string }; deletedAt?: null } }) => {
      const w = where.name;
      return live(where).find((p) => (typeof w === "string" ? p.name === w : ci(p.name, w.equals))) ?? null;
    }),
    count: vi.fn(async ({ where }: { where: { name: { equals: string }; deletedAt?: null } }) =>
      live(where).filter((p) => ci(p.name, where.name.equals)).length,
    ),
    findMany: vi.fn(async ({ where }: { where: { deletedAt?: null } }) => live(where)),
    findUnique: vi.fn(async () => people[0] ?? null),
    dumpUpdate: vi.fn(async () => ({ id: "d1" })),
    once: vi.fn(),
    recordError: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: { findFirst: h.findFirst, count: h.count, findMany: h.findMany, findUnique: h.findUnique },
    brainDump: { update: h.dumpUpdate },
    brainMemory: { create: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: h.recordError }));
vi.mock("@/lib/services/people/record-interaction", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/people/record-interaction")>()),
  recordInteractionOnce: h.once,
}));

import {
  JOURNAL_CONTACT_WINDOW_MS,
  JOURNAL_EXCERPT_CHARS,
  JOURNAL_LEDGER_NOTE_CHARS,
  journalExcerpt,
  linkJournalPeople,
  normalizeJournalPeople,
} from "@/lib/services/people/journal-link";
import { LEDGER_SOURCES, PersonNotFoundError } from "@/lib/services/people/record-interaction";

const createdAt = new Date("2026-11-02T14:00:00Z");
const text = "Talked to Dania about the move, she is nervous about the lease.";

function setPeople(list: P[]) {
  h.people.length = 0;
  h.people.push(...list);
}
const writtenIds = () => (h.dumpUpdate.mock.calls.at(-1)?.[0] as { data: { personIds: string[] } } | undefined)?.data.personIds;

beforeEach(() => {
  vi.clearAllMocks();
  setPeople([
    { id: "p_dania", name: "Dania" },
    { id: "p_ali1", name: "Ali" },
    { id: "p_ali2", name: "ALI" },
    { id: "p_sam", name: "Samir" },
  ]);
  h.once.mockResolvedValue({ skipped: false, recorded: { ledgerId: "l1" } });
});

describe("linkJournalPeople · the resolver gate", () => {
  it("an exact name links the entry and writes ONE contact row through recordInteractionOnce", async () => {
    const r = await linkJournalPeople({ dumpId: "d1", createdAt, rawText: text, people: [{ name: "Dania", interacted: true }] });
    expect(writtenIds()).toEqual(["p_dania"]);
    expect(h.dumpUpdate).toHaveBeenCalledWith({ where: { id: "d1" }, data: { personIds: ["p_dania"] } });
    expect(h.once).toHaveBeenCalledTimes(1);
    expect(h.once).toHaveBeenCalledWith({
      personId: "p_dania",
      amount: 1,
      note: text,
      source: "journal",
      at: createdAt,
      // once per (person, entry): the window opens AT the entry, so a re-process sees its own row and skips.
      noRowSince: createdAt,
      // Bounded (second reader P3-1): only a contact inside the entry day blocks it; a later gmail or manual row does not.
      noRowBefore: new Date(createdAt.getTime() + JOURNAL_CONTACT_WINDOW_MS),
      creditXp: false,
      metadata: { auto: true, via: "journal_ingest", dumpId: "d1", matchTier: "exact" },
    });
    expect(r).toMatchObject({ personIds: ["p_dania"], recorded: 1, skipped: 0, failed: 0 });
  });

  it("an unmatched name writes no id and no row", async () => {
    const r = await linkJournalPeople({ dumpId: "d1", createdAt, rawText: text, people: [{ name: "Zeinab", interacted: true }] });
    expect(writtenIds()).toEqual([]);
    expect(h.once).not.toHaveBeenCalled();
    expect(r.rejected).toBe(1);
  });

  it("an ambiguous name (two people match it case-insensitively) writes nothing", async () => {
    await linkJournalPeople({ dumpId: "d1", createdAt, rawText: text, people: [{ name: "ali", interacted: true }] });
    expect(writtenIds()).toEqual([]);
    expect(h.once).not.toHaveBeenCalled();
  });

  it("a unique case-insensitive match is accepted", async () => {
    await linkJournalPeople({ dumpId: "d1", createdAt, rawText: text, people: [{ name: "samir", interacted: true }] });
    expect(writtenIds()).toEqual(["p_sam"]);
    expect(h.once.mock.calls[0][0].metadata.matchTier).toBe("case_insensitive");
  });

  it("a typo-tier match (Levenshtein 1) is NOT accepted: the resolver takes the first near name with no tie check", async () => {
    // "Danya" is one substitution from "Dania". ("Danai", the resolver header's own example, is a transposition:
    // Levenshtein 2, so it lands in the Jaro-Winkler tier instead; the first cut of this test used it and the
    // accept-levenshtein mutant survived.)
    await linkJournalPeople({ dumpId: "d1", createdAt, rawText: text, people: [{ name: "Danya", interacted: true }] });
    expect(writtenIds()).toEqual([]);
    expect(h.once).not.toHaveBeenCalled();
  });

  it("a Jaro-Winkler match is NOT accepted", async () => {
    // Levenshtein 2 (outside tier 3), Jaro-Winkler above 0.92 (tier 4).
    setPeople([{ id: "p_mo", name: "Mohammed" }]);
    await linkJournalPeople({ dumpId: "d1", createdAt, rawText: text, people: [{ name: "Mohamad", interacted: true }] });
    expect(writtenIds()).toEqual([]);
  });

  it("a mention without contact links the entry but writes no ledger row (a mention is not a contact)", async () => {
    await linkJournalPeople({ dumpId: "d1", createdAt, rawText: "Should I trust Dania with the keys?", people: [{ name: "Dania", interacted: false }] });
    expect(writtenIds()).toEqual(["p_dania"]);
    expect(h.once).not.toHaveBeenCalled();
  });

  it("the same person named twice in one entry is one id and one row", async () => {
    await linkJournalPeople({
      dumpId: "d1",
      createdAt,
      rawText: text,
      people: [{ name: "Dania", interacted: false }, { name: "Dania", interacted: true }],
    });
    expect(writtenIds()).toEqual(["p_dania"]);
    expect(h.once).toHaveBeenCalledTimes(1);
  });

  it("guard canary: a person id written inside the entry text is never used as a key", async () => {
    await linkJournalPeople({
      dumpId: "d1",
      createdAt,
      rawText: "note to self p_dania call back",
      people: [{ name: "p_dania", interacted: true }],
    });
    expect(writtenIds()).toEqual([]);
    expect(h.once).not.toHaveBeenCalled();
    expect(h.findUnique).not.toHaveBeenCalled();
  });

  it("a person soft-deleted between resolve and write is counted as failed; the next person still gets a row", async () => {
    h.once.mockRejectedValueOnce(new PersonNotFoundError("p_dania"));
    const r = await linkJournalPeople({
      dumpId: "d1",
      createdAt,
      rawText: text,
      people: [{ name: "Dania", interacted: true }, { name: "Samir", interacted: true }],
    });
    expect(h.once).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ recorded: 1, failed: 1 });
  });

  it("a row already in the window is reported as skipped, not recorded", async () => {
    h.once.mockResolvedValueOnce({ skipped: true, reason: "already_logged_in_window", recorded: null });
    const r = await linkJournalPeople({ dumpId: "d1", createdAt, rawText: text, people: [{ name: "Dania", interacted: true }] });
    expect(r).toMatchObject({ recorded: 0, skipped: 1 });
  });

  it("the ledger note is his words, capped at JOURNAL_LEDGER_NOTE_CHARS", async () => {
    const long = `Talked to Dania. ${"x".repeat(400)}`;
    await linkJournalPeople({ dumpId: "d1", createdAt, rawText: long, people: [{ name: "Dania", interacted: true }] });
    const note = h.once.mock.calls[0][0].note as string;
    expect(JOURNAL_LEDGER_NOTE_CHARS).toBe(160);
    expect(note.length).toBeLessThanOrEqual(JOURNAL_LEDGER_NOTE_CHARS);
    expect(note.startsWith("Talked to Dania.")).toBe(true);
    expect(note).not.toMatch(/interaction reported/);
  });
});

describe("normalizeJournalPeople · the model's list", () => {
  it("keeps names, reads interacted only as boolean true, caps at 6", () => {
    const out = normalizeJournalPeople([
      { name: " Dania ", interacted: true },
      { name: "Sam", interacted: "yes" },
      "Mo",
      { name: "" },
      null,
      ...Array.from({ length: 10 }, (_, i) => ({ name: `P${i}` })),
    ]);
    expect(out[0]).toEqual({ name: "Dania", interacted: true });
    expect(out[1]).toEqual({ name: "Sam", interacted: false });
    expect(out[2]).toEqual({ name: "Mo", interacted: false });
    expect(out).toHaveLength(6);
  });
  it("a non-array is an empty list", () => {
    expect(normalizeJournalPeople("Dania")).toEqual([]);
  });
});

describe("LEDGER_SOURCES", () => {
  it("carries 'journal' so a journal contact is not mislabelled as chat", () => {
    expect(LEDGER_SOURCES).toContain("journal");
  });
});

describe("second readers on PR 3522", () => {
  it("P2-1: a rejected ledger write reaches recordError once, naming the entry and the person", async () => {
    h.once.mockRejectedValueOnce(new Error("connection reset"));
    const r = await linkJournalPeople({ dumpId: "d1", createdAt, rawText: text, people: [{ name: "Dania", interacted: true }] });
    expect(r.failed).toBe(1);
    expect(h.recordError).toHaveBeenCalledTimes(1);
    const [domain, err, ctx] = h.recordError.mock.calls[0];
    expect(domain).toBe("brain:journal-ingest");
    expect(String((err as Error).message)).toContain("connection reset");
    expect(ctx).toMatchObject({ phase: "people-contact", brainDumpId: "d1", failed: 1, personIdSuffixes: ["_dania"] });
  });

  it("control: a clean run calls recordError zero times", async () => {
    await linkJournalPeople({ dumpId: "d1", createdAt, rawText: text, people: [{ name: "Dania", interacted: true }] });
    expect(h.recordError).not.toHaveBeenCalled();
  });

  it("P2-2: lost_race is retried once; a second try that wins is one contact", async () => {
    h.once
      .mockResolvedValueOnce({ skipped: true, reason: "lost_race", recorded: null })
      .mockResolvedValueOnce({ skipped: false, recorded: { ledgerId: "l2" } });
    const r = await linkJournalPeople({ dumpId: "d1", createdAt, rawText: text, people: [{ name: "Dania", interacted: true }] });
    expect(h.once).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ recorded: 1, skipped: 0, failed: 0 });
  });

  it("P2-2: two lost races count as failed and reach recordError", async () => {
    h.once.mockResolvedValue({ skipped: true, reason: "lost_race", recorded: null });
    const r = await linkJournalPeople({ dumpId: "d1", createdAt, rawText: text, people: [{ name: "Dania", interacted: true }] });
    expect(h.once).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ recorded: 0, skipped: 0, failed: 1 });
    expect(h.recordError).toHaveBeenCalledTimes(1);
  });

  it("gap 2: a live 'samir' beside a soft-deleted 'Samir' links the live one; the count filters deletedAt", async () => {
    setPeople([
      { id: "p_sam_live", name: "samir" },
      { id: "p_sam_gone", name: "Samir", deletedAt: new Date("2026-10-01T00:00:00Z") },
    ]);
    await linkJournalPeople({ dumpId: "d1", createdAt, rawText: text, people: [{ name: "Samir", interacted: true }] });
    expect(writtenIds()).toEqual(["p_sam_live"]);
    expect(h.count.mock.calls[0][0].where).toMatchObject({ deletedAt: null });
  });
});

describe("journalExcerpt · the /people card line (gap 3)", () => {
  it("exactly JOURNAL_EXCERPT_CHARS is returned whole, no ellipsis", () => {
    const t = "a".repeat(JOURNAL_EXCERPT_CHARS);
    expect(journalExcerpt(t)).toBe(t);
  });
  it("one over, with a space at index 119: the trimmed 120-char prefix plus the ellipsis", () => {
    const t = `${"a".repeat(119)} b`;
    expect(t.length).toBe(JOURNAL_EXCERPT_CHARS + 1);
    expect(journalExcerpt(t)).toBe(`${"a".repeat(119)}…`);
  });
});
