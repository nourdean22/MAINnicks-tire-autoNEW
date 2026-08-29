/**
 * DUA franchise kit invariants.
 *
 * These assert BEHAVIOUR and CONTRACT, not presence. "Every kit has a
 * vocabulary array" would be the presence-shaped assertion this codebase
 * already learned to distrust; the tests below check the things that would
 * actually break a reel or the brand — a kit for a show that does not exist, an
 * audio identity that only works with the sound on, a second spoken signature
 * line for a character whose bible says it gets exactly one.
 */
import { describe, it, expect } from "vitest";
import {
  DUA_FRANCHISE_KITS,
  DUA_AUDIENCE_VOCABULARY,
  OVERLAY_ONLY_VOCABULARY,
  UNHOUSED_SHOW_CONCEPTS,
  buildDuaKitFragment,
  kitFor,
} from "./duaFranchiseKits";
import { FRANCHISES, type FranchiseId } from "./contentFranchises";
import { BRAND_CAST } from "./brandBible";
import { ABSURDITY_BAND, ABSURDITY_TYPES, DUA_ROLE_SPECS } from "./dua";

const ids = Object.keys(FRANCHISES) as FranchiseId[];

describe("kits and franchises stay in lockstep", () => {
  it("covers every registered franchise and invents none", () => {
    expect(Object.keys(DUA_FRANCHISE_KITS).sort()).toEqual([...ids].sort());
  });

  it("keys every kit to its own franchise", () => {
    for (const id of ids) expect(DUA_FRANCHISE_KITS[id].franchiseId).toBe(id);
  });

  it("returns null for an unregistered franchise rather than a default kit", () => {
    // A silent default would let a show ship with another show's sound.
    expect(kitFor("not_a_show" as never)).toBeNull();
  });
});

describe("every kit is usable", () => {
  it.each(ids)("%s declares a muted-first equivalent for its signature sound", (id) => {
    // Instagram plays muted by default, and the existing quality score awards 10
    // points for muted-first clarity. An audio identity that ignores that fights
    // its own gate.
    expect(DUA_FRANCHISE_KITS[id].audio.mutedFirstEquivalent.trim().length).toBeGreaterThan(20);
  });

  it.each(ids)("%s sits inside the default absurdity band", (id) => {
    const level = DUA_FRANCHISE_KITS[id].defaultLevel;
    expect(level).toBeGreaterThanOrEqual(ABSURDITY_BAND.min);
    expect(level).toBeLessThanOrEqual(ABSURDITY_BAND.max);
  });

  it.each(ids)("%s uses a registered absurdity type and registered roles", (id) => {
    const kit = DUA_FRANCHISE_KITS[id];
    expect(ABSURDITY_TYPES).toContain(kit.absurdityType);
    expect(kit.roles.length).toBeGreaterThan(0);
    for (const role of kit.roles) expect(DUA_ROLE_SPECS[role]).toBeDefined();
  });

  it.each(ids)("%s asks something only its own show could ask", (id) => {
    const kit = DUA_FRANCHISE_KITS[id];
    expect(kit.participation.length).toBeGreaterThan(0);
    for (const ask of kit.participation) {
      // Generic engagement bait is the failure mode. These asks are checked
      // against the phrases that mean "any account could have posted this".
      expect(ask.toLowerCase()).not.toMatch(/\b(?:like and follow|double tap|tag a friend|link in bio|drop a comment below)\b/);
    }
  });
});

describe("the brand bible stays the authority on THE METAL's signature line", () => {
  it("keeps 'The Metal Has Spoken' out of spoken vocabulary", () => {
    // BRAND_CAST.the_metal: "one line per episode, never two — repetition
    // destroys the signature". A second spoken catchphrase for the same
    // character would break that invariant silently.
    expect(OVERLAY_ONLY_VOCABULARY).toContain("The Metal Has Spoken");
    const metalInvariants = BRAND_CAST.the_metal.lockedInvariants.join(" ");
    expect(metalInvariants).toContain("The metal doesn't lie");
  });

  it("marks every overlay-only phrase as such wherever a kit teaches it", () => {
    for (const phrase of OVERLAY_ONLY_VOCABULARY) {
      expect(DUA_AUDIENCE_VOCABULARY).toContain(phrase);
    }
  });

  it("deduplicates the shared vocabulary rather than repeating it per show", () => {
    expect(new Set(DUA_AUDIENCE_VOCABULARY).size).toBe(DUA_AUDIENCE_VOCABULARY.length);
  });

  it("carries the recurring audience language the brand is built on", () => {
    for (const phrase of ["Maypop", "Exhibit A", "Euclid Avenue Survivor"]) {
      expect(DUA_AUDIENCE_VOCABULARY).toContain(phrase);
    }
  });
});

describe("shows with no franchise are recorded, not smuggled in", () => {
  it("names NASA Alignment as unhoused instead of adding a thirteenth franchise", () => {
    const names = UNHOUSED_SHOW_CONCEPTS.map((s) => s.name);
    expect(names).toContain("NASA Alignment");
    expect(Object.keys(FRANCHISES)).toHaveLength(12);
  });

  it("says what each unhoused show would need before it could ship", () => {
    for (const s of UNHOUSED_SHOW_CONCEPTS) expect(s.note.length).toBeGreaterThan(60);
  });
});

describe("buildDuaKitFragment", () => {
  it("carries the one rule into every prompt it builds", () => {
    const fragment = buildDuaKitFragment("pothole_court");
    expect(fragment).toContain("The absurd frame is packaging");
    expect(fragment).toContain("MUTED-FIRST");
  });

  it("names the show, its sound, and its cast", () => {
    const fragment = buildDuaKitFragment("tire_autopsy");
    expect(fragment).toContain(FRANCHISES.tire_autopsy.name);
    expect(fragment).toContain(DUA_FRANCHISE_KITS.tire_autopsy.audio.signature);
    expect(fragment).toContain(BRAND_CAST.nick_01.name);
  });

  it("warns the prompt which phrases are overlay-only", () => {
    expect(buildDuaKitFragment("cleveland_car_survival")).toContain("Overlay-only (never spoken)");
  });

  it("returns an empty fragment for an unregistered franchise rather than a half-built one", () => {
    expect(buildDuaKitFragment("not_a_show" as never)).toBe("");
  });
});
