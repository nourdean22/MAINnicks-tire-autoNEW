import { describe, it, expect, vi } from "vitest";

// person-profile-fuzzy imports @/lib/prisma at module load · mock it so the
// test needs no live DATABASE_URL (isNonName is a pure function, no DB).
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { isNonName } from "@/lib/brain/person-profile-fuzzy";

/**
 * 2026-06-06 · Power Atlas ghost-row fix (bug b).
 * The Nick agent emitted person.update { name: "her" } / "the caller",
 * which created junk PersonProfile rows. `isNonName` is the guard that now
 * rejects pronoun / descriptor inputs before any create. This locks the
 * behavior so a future edit can't silently re-open the ghost-row hole.
 */
describe("isNonName — pronoun / descriptor guard", () => {
  it("rejects bare pronouns (any case / whitespace)", () => {
    for (const p of ["her", "him", "she", "he", "they", "them", "it", "Her", "HIM", " she "]) {
      expect(isNonName(p)).toBe(true);
    }
  });

  it("rejects generic descriptors and article+descriptor phrases", () => {
    for (const d of [
      "the caller", "a woman", "that guy", "this person", "some lady",
      "customer", "client", "lead", "stranger", "unknown", "n/a", "tbd", "the",
    ]) {
      expect(isNonName(d)).toBe(true);
    }
  });

  it("rejects empty / punctuation-only / number-only input", () => {
    for (const x of ["", "   ", "???", "123", "  --  "]) {
      expect(isNonName(x)).toBe(true);
    }
  });

  it("accepts real personal names", () => {
    for (const n of [
      "Dania", "Mo", "Fernando Romero", "Zach Worker", "Manny", "Mash",
      "Nimeh", "Gigi", "Mimi", "O'Brien", "Jean-Luc",
    ]) {
      expect(isNonName(n)).toBe(false);
    }
  });

  it("does not reject real names that merely CONTAIN a stop-word substring", () => {
    // "Heather" contains "he"/"her"; "Theo" contains "the" — both real names.
    for (const n of ["Heather", "Thelma", "Mandy", "Manuel", "Theo", "Hera"]) {
      expect(isNonName(n)).toBe(false);
    }
  });
});
