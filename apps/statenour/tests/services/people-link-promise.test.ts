/**
 * A promise task names a person -> the task links to that person (people W0, 2026-10-30).
 *
 * Task.personId was only set when the model passed a real profile id, so in
 * prod 0 tasks were linked and every "open promises to X" surface read empty,
 * while 15 promise tasks named someone in `promiseTo`. The link now happens
 * on the enrich pass, exact or case-insensitive name only: a fuzzy tier could
 * pin a promise on the wrong person, and he never confirmed this link.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  taskFindUnique: vi.fn(),
  taskUpdateMany: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { task: { findUnique: h.taskFindUnique, updateMany: h.taskUpdateMany } },
}));
vi.mock("@/lib/brain/person-profile-fuzzy", () => ({ resolvePersonByName: h.resolve }));

import { linkPromiseToPerson } from "@/lib/services/people/link-promise";

beforeEach(() => {
  vi.clearAllMocks();
  h.taskUpdateMany.mockResolvedValue({ count: 1 });
});

describe("linkPromiseToPerson", () => {
  it("links an unlinked promise task to the exact-named person, compare-and-set", async () => {
    h.taskFindUnique.mockResolvedValue({ id: "t1", personId: null, promiseTo: "Sam" });
    h.resolve.mockResolvedValue({ matched: true, matchTier: "exact", person: { id: "p1", name: "Sam" } });

    expect(await linkPromiseToPerson("t1")).toBe("linked");
    expect(h.resolve).toHaveBeenCalledWith("Sam", expect.objectContaining({ createIfMissing: false }));
    expect(h.taskUpdateMany).toHaveBeenCalledWith({ where: { id: "t1", personId: null }, data: { personId: "p1" } });
  });

  it("accepts a case-insensitive match", async () => {
    h.taskFindUnique.mockResolvedValue({ id: "t1", personId: null, promiseTo: "sam" });
    h.resolve.mockResolvedValue({ matched: true, matchTier: "case_insensitive", person: { id: "p1", name: "Sam" } });
    expect(await linkPromiseToPerson("t1")).toBe("linked");
  });

  it("refuses fuzzy tiers: an unconfirmed link must not guess", async () => {
    h.taskFindUnique.mockResolvedValue({ id: "t1", personId: null, promiseTo: "Sem" });
    for (const matchTier of ["levenshtein", "jaro_winkler"]) {
      h.resolve.mockResolvedValue({ matched: true, matchTier, person: { id: "p1", name: "Sam" } });
      expect(await linkPromiseToPerson("t1")).toBe("no_match");
    }
    expect(h.taskUpdateMany).not.toHaveBeenCalled();
  });

  it("a lost compare-and-set (someone linked it first) is skipped, not linked", async () => {
    h.taskFindUnique.mockResolvedValue({ id: "t1", personId: null, promiseTo: "Sam" });
    h.resolve.mockResolvedValue({ matched: true, matchTier: "exact", person: { id: "p1", name: "Sam" } });
    h.taskUpdateMany.mockResolvedValue({ count: 0 });
    expect(await linkPromiseToPerson("t1")).toBe("skipped");
  });

  it("leaves an already-linked task alone", async () => {
    h.taskFindUnique.mockResolvedValue({ id: "t1", personId: "p9", promiseTo: "Sam" });
    expect(await linkPromiseToPerson("t1")).toBe("skipped");
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it("skips self and empty promises without a lookup", async () => {
    for (const promiseTo of [null, "", "  ", "myself", "Me", "self"]) {
      h.taskFindUnique.mockResolvedValue({ id: "t1", personId: null, promiseTo });
      expect(await linkPromiseToPerson("t1")).toBe("skipped");
    }
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it("a failed read is an error outcome, never a throw", async () => {
    h.taskFindUnique.mockRejectedValue(new Error("db down"));
    expect(await linkPromiseToPerson("t1")).toBe("error");
  });
});
