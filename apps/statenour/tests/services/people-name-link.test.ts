/**
 * W8b manager round 1, items 2 + 8 · the save-time name link and the backfill share one rule (namedInText).
 *
 * "Will" must not link on "I will". A one-word name that starts a sentence does not count ("Will called" is as likely
 * the verb). A name more than one live profile answers to links nobody. Must hold before the backfill runs over the
 * ~1,564 old entries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type P = { id: string; name: string; deletedAt?: Date | null };
const h = vi.hoisted(() => {
  const people: P[] = [];
  const ci = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const live = (where: { deletedAt?: null }) => people.filter((p) => !("deletedAt" in where) || !p.deletedAt);
  return {
    people,
    findFirst: vi.fn(async ({ where }: { where: { name: string | { equals: string }; deletedAt?: null } }) => {
      const w = where.name;
      return live(where).find((p) => (typeof w === "string" ? p.name === w : ci(p.name, w.equals))) ?? null;
    }),
    count: vi.fn(async ({ where }: { where: { name: { equals: string }; deletedAt?: null } }) => live(where).filter((p) => ci(p.name, where.name.equals)).length),
    findMany: vi.fn(async ({ where }: { where: { deletedAt?: null } }) => live(where)),
    reflUpdate: vi.fn(async () => ({ id: "r1" })),
    info: vi.fn(),
  };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: { findFirst: h.findFirst, count: h.count, findMany: h.findMany, findUnique: vi.fn(async () => null) },
    brainDump: { update: vi.fn() },
    reflection: { update: h.reflUpdate, findUnique: vi.fn(async () => ({ personIds: [] })) },
    brainMemory: { create: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/services/people/record-interaction", () => ({ PersonNotFoundError: class extends Error {}, recordInteractionOnce: vi.fn() }));
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: () => ({ info: h.info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } };
});

import { linkJournalPeople, linkNamedPeople } from "@/lib/services/people/journal-link";

const createdAt = new Date("2026-11-03T14:00:00Z");
const setPeople = (...names: Array<[string, string]>) => {
  h.people.length = 0;
  for (const [id, name] of names) h.people.push({ id, name });
};
const link = async (rawText: string) => {
  h.reflUpdate.mockClear();
  const r = await linkNamedPeople({ silo: "reflection", dumpId: "r1", createdAt, rawText });
  const ids = (h.reflUpdate.mock.calls.at(-1) as unknown as [{ data: { personIds: string[] } }] | undefined)?.[0].data.personIds ?? [];
  return { names: r.names, ids };
};

beforeEach(() => {
  h.info.mockClear();
});

describe("linkNamedPeople · case and sentence start (item 2)", () => {
  it('"I will call" links nobody; the name is case-sensitive', async () => {
    setPeople(["p_will", "Will"]);
    expect((await link("I will call the shop.")).ids).toEqual([]);
    expect((await link("told him what will happen")).ids).toEqual([]);
  });

  it('a one-word name that starts a sentence does not count: "Will called", and after a period or a newline', async () => {
    setPeople(["p_will", "Will"]);
    expect((await link("Will called about the invoice.")).ids).toEqual([]);
    expect((await link("Slow day. Will see how it goes.")).ids).toEqual([]);
    expect((await link("Monday\nWill do it later")).ids).toEqual([]);
  });

  it('a one-word name inside a sentence links: "talked to Will today"', async () => {
    setPeople(["p_will", "Will"]);
    expect(await link("talked to Will today")).toEqual({ names: ["Will"], ids: ["p_will"] });
  });

  it("a later mention still counts when the first one starts a sentence", async () => {
    setPeople(["p_will", "Will"]);
    expect((await link("Will do. Then I called Will back.")).ids).toEqual(["p_will"]);
  });

  it("a two-word full name links anywhere, the start of a sentence included", async () => {
    setPeople(["p_sj", "Sam Jones"]);
    expect((await link("Sam Jones came by.")).ids).toEqual(["p_sj"]);
    expect((await link("met Sam Jones")).ids).toEqual(["p_sj"]);
  });

  it("a one-word name inside a longer person's name is that longer person, not both", async () => {
    setPeople(["p_s", "Sam"], ["p_sj", "Sam Jones"]);
    expect((await link("met Sam Jones today")).ids).toEqual(["p_sj"]);
    expect((await link("met Sam today")).ids).toEqual(["p_s"]);
  });
});

describe("linkNamedPeople · namesakes (item 8)", () => {
  it("two profiles named Sam: links no one and logs the ambiguity as a count, never a name", async () => {
    setPeople(["p_sam1", "Sam"], ["p_sam2", "Sam"]);
    expect((await link("talked to Sam today")).ids).toEqual([]);
    expect(h.info).toHaveBeenCalledWith("journal_people_ambiguous", expect.objectContaining({ ambiguous: 1 }));
    expect(JSON.stringify(h.info.mock.calls)).not.toContain("Sam");
  });

  it("Ali and ALI: one exact-case hit is still two profiles, links no one; a unique name beside them links", async () => {
    setPeople(["p_ali1", "Ali"], ["p_ali2", "ALI"], ["p_d", "Dania"]);
    expect((await link("saw Ali and then Dania")).ids).toEqual(["p_d"]);
  });

  it("a deleted namesake does not make a live name ambiguous", async () => {
    setPeople(["p_sam1", "Sam"]);
    h.people.push({ id: "p_sam2", name: "Sam", deletedAt: new Date() });
    expect((await link("talked to Sam today")).ids).toEqual(["p_sam1"]);
  });
});

describe("linkJournalPeople · the model path refuses namesakes too (item 8)", () => {
  it('an exact-tier "Sam" with two Sam profiles links no one and is reported refused', async () => {
    setPeople(["p_sam1", "Sam"], ["p_sam2", "Sam"]);
    h.reflUpdate.mockClear();
    const r = await linkJournalPeople({ silo: "reflection", dumpId: "r1", createdAt, rawText: "Sam came by", people: [{ name: "Sam", interacted: false }] });
    expect(r.personIds).toEqual([]);
    expect(r.rejectedNames).toEqual(["Sam"]);
  });
});
