/**
 * Every line-reading path treats a nickname as the person: the save-time journal link, the excerpt, the calendar line,
 * the promise link and the ledger resolver. Nicknames ignore case and the sentence-start rule (he types "mom called").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type P = { id: string; name: string; metadata?: unknown };
const h = vi.hoisted(() => ({
  people: [] as P[],
  task: null as null | { id: string; personId: string | null; promiseTo: string | null },
  taskUpdate: vi.fn(async () => ({ count: 1 })),
  reflUpdate: vi.fn(async () => ({ id: "r1" })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: {
      findFirst: vi.fn(async ({ where }: { where: { name: string | { equals: string } } }) => {
        const w = where.name;
        return h.people.find((p) => (typeof w === "string" ? p.name === w : p.name.toLowerCase() === w.equals.toLowerCase())) ?? null;
      }),
      count: vi.fn(async ({ where }: { where: { name: { equals: string } } }) =>
        h.people.filter((p) => p.name.toLowerCase() === where.name.equals.toLowerCase()).length,
      ),
      // Honours the select, so a read that forgets metadata sees no nicknames, as it would in production.
      findMany: vi.fn(async ({ where, select }: { where: { name?: { equals: string } }; select?: { metadata?: boolean } }) => {
        const rows = where.name ? h.people.filter((p) => p.name.toLowerCase() === where.name!.equals.toLowerCase()) : h.people;
        return select?.metadata ? rows : rows.map(({ id, name }) => ({ id, name }));
      }),
    },
    task: { findUnique: vi.fn(async () => h.task), updateMany: h.taskUpdate },
    brainDump: { update: vi.fn() },
    reflection: { update: h.reflUpdate, findUnique: vi.fn(async () => ({ personIds: [] })) },
    brainMemory: { create: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/services/people/record-interaction", () => ({ PersonNotFoundError: class extends Error {}, recordInteractionOnce: vi.fn() }));

import { namedInText, nicknameMatchers } from "@/lib/services/people/backfill-plan";
import { journalExcerpt, linkJournalPeople, linkNamedPeople } from "@/lib/services/people/journal-link";
import { linkPromiseToPerson } from "@/lib/services/people/link-promise";
import { resolveLedgerPerson } from "@/lib/services/people/log-from-text";
import { nextEventByPerson } from "@/lib/services/people/calendar-mentions";
import { personIdByNickname, resolvePersonForBusinessSearch } from "@/lib/services/people/nicknames";

const yummah: P = { id: "y", name: "Yummah", metadata: { nicknames: ["mom"] } };
const mash: P = { id: "m", name: "Mash", metadata: { nicknames: ["mashi"] } };
const lahb: P = { id: "l", name: "Lahb", metadata: { nicknames: ["Lah"] } };
const ids = (r: { people: Array<{ id: string }> }) => r.people.map((p) => p.id);

beforeEach(() => {
  h.people = [yummah, mash, lahb];
  h.task = null;
  vi.clearAllMocks();
});

describe("namedInText · nicknames", () => {
  it("'mom called' links the Yummah fixture: lower case, at the start of the line", () => {
    expect(ids(namedInText("mom called about the move", h.people))).toEqual(["y"]);
  });

  it("matches in any case, as a whole word", () => {
    expect(ids(namedInText("Told MOM and lah.", h.people))).toEqual(["y", "l"]);
    expect(ids(namedInText("a big moment for the mommy group", h.people))).toEqual([]);
  });

  it("a nickname shared by two live people links nobody and counts as ambiguous", () => {
    const other = { id: "o", name: "Olivia", metadata: { nicknames: ["mom"] } };
    expect(namedInText("mom called", [yummah, other])).toEqual({ people: [], ambiguous: 1 });
  });

  it("a nickname equal to another person's name loses to that name, whose rule still applies", () => {
    const people = [
      { id: "s", name: "Sam", metadata: { nicknames: ["Will"] } },
      { id: "w", name: "Will" },
    ];
    expect(ids(namedInText("I will call", people))).toEqual([]);
    expect(ids(namedInText("Saw Will today", people))).toEqual(["w"]);
  });

  it("a full name swallows a nickname inside it, and a two-word nickname swallows a name inside it", () => {
    const sam = { id: "s", name: "Sam", metadata: { nicknames: ["jones"] } };
    const full = { id: "f", name: "Sam Jones" };
    expect(ids(namedInText("met Sam Jones", [sam, full]))).toEqual(["f"]);
    const mike = { id: "k", name: "Mike" };
    const big = { id: "b", name: "Robert", metadata: { nicknames: ["big mike"] } };
    expect(ids(namedInText("saw Big Mike", [mike, big]))).toEqual(["b"]);
  });

  it("a name and its own nickname in one line link once", () => {
    expect(ids(namedInText("saw Mash, mashi was fine", h.people))).toEqual(["m"]);
  });

  it("people with no metadata behave exactly as before", () => {
    expect(ids(namedInText("saw Dania", [{ id: "d", name: "Dania" }]))).toEqual(["d"]);
  });
});

describe("the save-time link", () => {
  it("linkNamedPeople stores Yummah's id on a 'mom called' line and reads her back by name", async () => {
    const r = await linkNamedPeople({ silo: "reflection", dumpId: "r1", createdAt: new Date(), rawText: "mom called" });
    expect(r.names).toEqual(["Yummah"]);
    expect(h.reflUpdate).toHaveBeenCalledWith({ where: { id: "r1" }, data: { personIds: ["y"] } });
  });

  it("the model pass passes a nickname through the gate", async () => {
    const r = await linkJournalPeople({
      silo: "reflection",
      dumpId: "r1",
      createdAt: new Date(),
      rawText: "talked to mom",
      people: [{ name: "mom", interacted: false }],
    });
    expect(r).toMatchObject({ personIds: ["y"], linkedNames: ["Yummah"], rejected: 0 });
  });

  it("the model pass refuses a shared nickname and says so", async () => {
    h.people = [yummah, { id: "o", name: "Olivia", metadata: { nicknames: ["mom"] } }];
    const r = await linkJournalPeople({
      silo: "reflection",
      dumpId: "r1",
      createdAt: new Date(),
      rawText: "talked to mom",
      people: [{ name: "mom", interacted: false }],
    });
    expect(r).toMatchObject({ personIds: [], rejectedNames: ["mom"] });
  });
});

describe("journalExcerpt", () => {
  it("windows on a nickname when the line never spells the name", () => {
    const line = `${"filler words here ".repeat(10)}then mom called about the move ${"and more ".repeat(10)}`;
    expect(journalExcerpt(line, "Yummah", ["mom"])).toContain("mom called");
    expect(journalExcerpt(line, "Yummah")).not.toContain("mom called");
  });
});

describe("linkPromiseToPerson", () => {
  it("a promise to 'mom' links Yummah", async () => {
    h.task = { id: "t", personId: null, promiseTo: "mom" };
    expect(await linkPromiseToPerson("t")).toBe("linked");
    expect(h.taskUpdate).toHaveBeenCalledWith({ where: { id: "t", personId: null }, data: { personId: "y" } });
  });
});

describe("resolveLedgerPerson", () => {
  it("a nickname resolves", async () => {
    expect(await resolveLedgerPerson("mashi", { allowTypoMatch: false })).toEqual({
      kind: "resolved",
      person: { id: "m", name: "Mash" },
      matchTier: "nickname",
    });
  });

  it("a shared nickname is ambiguous, with both people to pick from", async () => {
    h.people = [yummah, { id: "o", name: "Olivia", metadata: { nicknames: ["mom"] } }];
    expect(await resolveLedgerPerson("mom", { allowTypoMatch: true })).toMatchObject({
      kind: "ambiguous",
      reason: "same_name",
      candidates: [{ name: "Yummah" }, { name: "Olivia" }],
    });
  });
});

describe("nextEventByPerson", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const at = "2026-11-06T17:00:00Z";

  it("a calendar title with a nickname counts for that person", () => {
    const out = nextEventByPerson([{ summary: "Lunch with mom", start: at }], h.people, now);
    expect(out.get("y")).toEqual(new Date(at));
  });

  it("a shared nickname marks nobody", () => {
    const people = [yummah, { id: "o", name: "Olivia", metadata: { nicknames: ["mom"] } }];
    expect(nextEventByPerson([{ summary: "Lunch with mom", start: at }], people, now).size).toBe(0);
  });
});

describe("personIdByNickname", () => {
  it("answers for a nickname only", async () => {
    expect(await personIdByNickname("mom")).toBe("y");
    expect(await personIdByNickname("Yummah")).toBeNull();
    expect(await personIdByNickname("nobody")).toBeNull();
  });
});

describe("resolvePersonForBusinessSearch", () => {
  it("resolves an exact nickname before a partial formal-name hit", async () => {
    h.people = [
      { id: "m", name: "Mash", metadata: null },
      { id: "a", name: "Ashley", metadata: { nicknames: ["ash"] } },
    ];
    expect(await resolvePersonForBusinessSearch("ash")).toMatchObject({
      person: { id: "a", name: "Ashley" },
      ambiguous: false,
    });
  });

  it("stops on a shared nickname instead of falling through to a partial name", async () => {
    h.people = [
      { id: "m", name: "Mash", metadata: null },
      { id: "a", name: "Ashley", metadata: { nicknames: ["ash"] } },
      { id: "b", name: "Bashir", metadata: { nicknames: ["ash"] } },
    ];
    expect(await resolvePersonForBusinessSearch("ash")).toMatchObject({ person: null, ambiguous: true });
  });
});

describe("nicknameMatchers", () => {
  it("gives one whole-word matcher per working nickname", () => {
    const m = nicknameMatchers([yummah]);
    expect(m.map((x) => x.person.id)).toEqual(["y"]);
    expect(m[0].re.test("call Mom")).toBe(true);
    expect(m[0].re.test("moment")).toBe(false);
  });
});
