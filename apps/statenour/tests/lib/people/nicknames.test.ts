/**
 * Nicknames live on PersonProfile.metadata.nicknames. This file pins the one reader and the one rule every matching
 * path shares: a nickname on two live people links nobody, and a nickname equal to anyone's name loses to that name.
 */
import { describe, expect, it } from "vitest";

import { cleanNicknames, nicknameOwners, readNicknames, workingNicknames } from "@/lib/people/nicknames";

const yummah = { id: "y", name: "Yummah", metadata: { nicknames: ["mom"], enrichTriedAt: "2026-11-01" } };
const mash = { id: "m", name: "Mash", metadata: { nicknames: ["mashi"] } };

describe("readNicknames", () => {
  it("reads the list off metadata", () => {
    expect(readNicknames(yummah.metadata)).toEqual(["mom"]);
  });

  it("is empty for null, an array, a missing key and a non-array value", () => {
    for (const m of [null, undefined, [], "mom", {}, { nicknames: "mom" }]) expect(readNicknames(m)).toEqual([]);
  });

  it("a pronoun stored by hand reads as no nickname", () => {
    expect(readNicknames({ nicknames: ["her", "mom"] })).toEqual(["mom"]);
  });

  it("drops non-strings a hand edit left behind", () => {
    expect(readNicknames({ nicknames: ["mom", 3, null] })).toEqual(["mom"]);
  });
});

describe("cleanNicknames", () => {
  it("trims, collapses spaces, keeps his spelling, dedupes in any case", () => {
    expect(cleanNicknames(["  Lah ", "lah", "big   mike"])).toEqual(["Lah", "big mike"]);
  });

  it("drops one-letter and over-long entries", () => {
    expect(cleanNicknames(["m", "x".repeat(41), "ma"])).toEqual(["ma"]);
  });

  it("refuses pronouns and descriptors: every 'her' in every entry would link that person", () => {
    expect(cleanNicknames(["her", "he", "me", "them", "the caller", "mom", "mashi"])).toEqual(["mom", "mashi"]);
  });

  it("caps the list", () => {
    expect(cleanNicknames(Array.from({ length: 20 }, (_, i) => `nick${i}`))).toHaveLength(12);
  });
});

describe("nicknameOwners", () => {
  it("maps a lower-cased nickname to who uses it", () => {
    const owners = nicknameOwners([yummah, mash]);
    expect(owners.get("mom")).toEqual([yummah]);
    expect(owners.get("mashi")).toEqual([mash]);
  });

  it("lists every owner of a shared nickname, whatever the case", () => {
    const other = { id: "o", name: "Other", metadata: { nicknames: ["MOM"] } };
    expect(nicknameOwners([yummah, other]).get("mom")).toEqual([yummah, other]);
  });

  it("a nickname equal to another person's name is no nickname at all", () => {
    const sam = { id: "s", name: "Sam", metadata: { nicknames: ["will"] } };
    const will = { id: "w", name: "Will" };
    expect(nicknameOwners([sam, will]).has("will")).toBe(false);
  });
});

describe("workingNicknames", () => {
  it("keeps only the nicknames that point at this one person", () => {
    const other = { id: "o", name: "Other", metadata: { nicknames: ["mom", "boss"] } };
    const people = [yummah, other];
    expect(workingNicknames(yummah, people)).toEqual([]);
    expect(workingNicknames(other, people)).toEqual(["boss"]);
  });
});
