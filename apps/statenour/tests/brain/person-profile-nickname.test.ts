/**
 * The resolver treats a nickname as the person. He renamed one profile to Yummah and "mom" stopped matching; the tier
 * sits after both name tiers (a real name always wins) and before the fuzzy tiers and the non-name refusal.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type P = { id: string; name: string; metadata?: unknown };
const h = vi.hoisted(() => ({
  people: [] as P[],
  create: vi.fn(),
  memCreate: vi.fn(async () => ({ id: "m" })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: {
      findFirst: vi.fn(async ({ where }: { where: { name: string | { equals: string } } }) => {
        const w = where.name;
        return (
          h.people.find((p) => (typeof w === "string" ? p.name === w : p.name.toLowerCase() === w.equals.toLowerCase())) ?? null
        );
      }),
      findMany: vi.fn(async () => h.people),
      create: h.create,
    },
    brainMemory: { create: h.memCreate },
  },
}));

import { resolvePersonByName } from "@/lib/brain/person-profile-fuzzy";

const yummah = { id: "y", name: "Yummah", metadata: { nicknames: ["mom"] } };

beforeEach(() => {
  h.people = [yummah];
  vi.clearAllMocks();
});

describe("resolvePersonByName · nickname tier", () => {
  it("resolves a nickname to its owner, in any case", async () => {
    for (const said of ["mom", "Mom", "MOM"]) {
      expect(await resolvePersonByName(said, { createIfMissing: false })).toEqual({
        person: { id: "y", name: "Yummah" },
        matched: true,
        matchTier: "nickname",
      });
    }
  });

  it("the non-name guard still wins: a pronoun stored as a nickname resolves to nobody", async () => {
    h.people = [{ id: "b", name: "Bahaa", metadata: { nicknames: ["her"] } }];
    expect(await resolvePersonByName("her", { createIfMissing: false })).toEqual({
      person: null,
      matched: false,
      matchTier: "rejected_nonname",
    });
  });

  it("a shared nickname links nobody and names who shares it", async () => {
    const other = { id: "o", name: "Olivia", metadata: { nicknames: ["Mom"] } };
    h.people = [yummah, other];
    expect(await resolvePersonByName("mom", { createIfMissing: false })).toEqual({
      person: null,
      matched: false,
      matchTier: "shared_nickname",
      candidates: [
        { id: "y", name: "Yummah" },
        { id: "o", name: "Olivia" },
      ],
    });
  });

  it("a shared nickname never falls through to a typo-close name, and never creates", async () => {
    h.people = [
      { id: "a", name: "Mommi" },
      { id: "b", name: "Ann", metadata: { nicknames: ["mommy"] } },
      { id: "c", name: "Bea", metadata: { nicknames: ["mommy"] } },
    ];
    expect(await resolvePersonByName("mommy")).toMatchObject({ person: null, matchTier: "shared_nickname" });
    expect(h.memCreate).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("a real name beats a nickname on someone else", async () => {
    h.people = [
      { id: "s", name: "Sam", metadata: { nicknames: ["Will"] } },
      { id: "w", name: "Will" },
    ];
    expect(await resolvePersonByName("Will", { createIfMissing: false })).toMatchObject({
      person: { id: "w", name: "Will" },
      matchTier: "exact",
    });
  });

  it("runs with the fuzzy tiers off, and a nickname is not fuzzy", async () => {
    expect(await resolvePersonByName("mom", { createIfMissing: false, fuzzy: false })).toMatchObject({ matchTier: "nickname" });
    h.people = [{ id: "y", name: "Yummah", metadata: { nicknames: ["mommy"] } }];
    expect(await resolvePersonByName("mommi", { createIfMissing: false })).toMatchObject({ matchTier: "no_match" });
  });

  it("writes no Auto-merged memory: he chose this name", async () => {
    await resolvePersonByName("mom", { createIfMissing: false });
    expect(h.memCreate).not.toHaveBeenCalled();
  });
});
