/**
 * W8b · `fuzzy: false` on resolvePersonByName: exact and case-insensitive tiers only. The journal gate refuses the
 * Levenshtein and Jaro-Winkler tiers anyway, but the resolver used to run them (and write an "Auto-merged" audit
 * memory for the match) before the gate threw the answer away.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), memCreate: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: { findFirst: h.findFirst, findMany: h.findMany, create: h.create },
    brainMemory: { create: h.memCreate },
  },
}));

import { resolvePersonByName } from "@/lib/brain/person-profile-fuzzy";

beforeEach(() => {
  vi.clearAllMocks();
  h.findFirst.mockResolvedValue(null);
  h.findMany.mockResolvedValue([{ id: "p1", name: "Dania" }]);
  h.memCreate.mockResolvedValue({ id: "m" });
});

describe("resolvePersonByName · fuzzy: false", () => {
  it("default: a one-letter typo matches by Levenshtein and logs the merge", async () => {
    const r = await resolvePersonByName("Danya", { createIfMissing: false });
    expect(r).toMatchObject({ matched: true, matchTier: "levenshtein" });
    expect(h.findMany).toHaveBeenCalledTimes(1);
  });

  it("fuzzy off: the same typo is no_match, no Auto-merged row (the scan runs for the nickname tier only)", async () => {
    const r = await resolvePersonByName("Danya", { createIfMissing: false, fuzzy: false });
    expect(r).toEqual({ person: null, matched: false, matchTier: "no_match" });
    expect(h.memCreate).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("fuzzy off still finds the exact and case-insensitive tiers", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "p1", name: "Dania" });
    expect(await resolvePersonByName("Dania", { createIfMissing: false, fuzzy: false })).toMatchObject({ matchTier: "exact" });
    h.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "p1", name: "Dania" });
    expect(await resolvePersonByName("dania", { createIfMissing: false, fuzzy: false })).toMatchObject({ matchTier: "case_insensitive" });
  });
});
