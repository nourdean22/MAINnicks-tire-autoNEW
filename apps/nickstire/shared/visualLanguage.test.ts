/**
 * Creative Visual Language — sixteen grammars that are compositions, not
 * skins. The load-bearing assertion is the distinctness triple: if two
 * grammars share (grid, hierarchy, imageTreatment) they are one layout with
 * two names, which is exactly the failure README §J warns about ("16 families
 * are not 16 skins"). The mapping tests make the three renderers' vocabularies
 * resolve into this one without a gap.
 *
 * Positive control: with `tiny_world` temporarily pointed at a grammar that
 * is a copy of `forensic_macro`, the distinctness test fails on the duplicate
 * triple (checked by hand before the data was finalised — the test counts
 * unique triples, so a copy drops the count below the floor).
 */
import { describe, expect, it } from "vitest";
import { NOIR_PALETTE } from "./brandBible";
import { VISUAL_GRAMMARS, familyGrammar, territoryGrammar } from "./visualLanguage";
import { VISUAL_FAMILIES } from "../server/services/visualFamily";
import { CAROUSEL_TERRITORY_DESIGNS } from "../server/services/carouselSlideRenderer";
import { CREATIVE_TERRITORIES } from "../client/src/lib/igCarouselStudio";

const grammars = Object.values(VISUAL_GRAMMARS);

describe("the sixteen grammars", () => {
  it("there are exactly 16, keyed by their own id", () => {
    expect(Object.keys(VISUAL_GRAMMARS)).toHaveLength(16);
    for (const [key, g] of Object.entries(VISUAL_GRAMMARS)) expect(g.id).toBe(key);
  });

  it("at least 14 have pairwise-distinct (grid, hierarchy, imageTreatment) triples — compositions, not skins", () => {
    const triples = new Set(grammars.map((g) => `${g.grid}|${g.hierarchy}|${g.imageTreatment}`));
    expect(triples.size).toBeGreaterThanOrEqual(14);
    // And in fact every one of them is distinct today; the floor above is the
    // contract, this line is the receipt.
    expect(triples.size).toBe(16);
  });

  it("every grammar carries a complete contract and a unique originality fingerprint", () => {
    const fingerprints = new Set<string>();
    for (const g of grammars) {
      expect(g.label.length).toBeGreaterThan(3);
      expect(g.suitableFor.length).toBeGreaterThan(0);
      expect(g.unsuitableFor.length).toBeGreaterThan(0);
      expect(["required", "optional", "none"]).toContain(g.subjectRequirement);
      expect(g.copyBudget).toBeGreaterThan(80);
      expect(g.copyBudget).toBeLessThanOrEqual(320);
      for (const field of ["accentUsage", "safeZones", "ctaBehaviour", "slideProgression"] as const) {
        expect(g[field].length, `${g.id}.${field}`).toBeGreaterThan(10);
      }
      // Motion adaptations are motion-family ids (README §C-E), e.g. "split_wipe".
      expect(g.motionAdaptation.length, `${g.id}.motionAdaptation`).toBeGreaterThanOrEqual(8);
      expect(fingerprints.has(g.originalityFingerprint), `${g.id} fingerprint duplicates another`).toBe(false);
      fingerprints.add(g.originalityFingerprint);
    }
  });

  it("tokens are NOIR_PALETTE keys and the data carries no hex literal anywhere", () => {
    const keys = Object.keys(NOIR_PALETTE);
    for (const g of grammars) {
      for (const token of Object.values(g.tokens)) expect(keys).toContain(token);
    }
    expect(JSON.stringify(VISUAL_GRAMMARS)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("renderer vocabularies resolve into the language", () => {
  it("every static family maps to one grammar, and carries it", () => {
    for (const [id, family] of Object.entries(VISUAL_FAMILIES)) {
      const grammarId = familyGrammar[id as keyof typeof familyGrammar];
      expect(grammarId, `family ${id} has no grammar`).toBeDefined();
      expect(family.grammar).toBe(VISUAL_GRAMMARS[grammarId]);
      // The family's own subject rule must agree with the grammar it aliases.
      expect(family.subject).toBe(family.grammar.subjectRequirement);
    }
    expect(Object.keys(familyGrammar).sort()).toEqual(Object.keys(VISUAL_FAMILIES).sort());
  });

  it("every carousel territory (13) maps to one grammar", () => {
    const territories = Object.keys(CREATIVE_TERRITORIES).sort();
    expect(Object.keys(territoryGrammar).sort()).toEqual(territories);
    expect(Object.keys(CAROUSEL_TERRITORY_DESIGNS).sort()).toEqual(territories);
    for (const t of territories) expect(VISUAL_GRAMMARS[territoryGrammar[t as keyof typeof territoryGrammar]]).toBeDefined();
  });

  it("the Ad Studio poster is the industrial_editorial grammar", () => {
    expect(VISUAL_GRAMMARS.industrial_editorial.suitableFor.join(" ")).toContain("adStudio/adTemplate.ts");
  });
});
