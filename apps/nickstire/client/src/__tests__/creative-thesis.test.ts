/**
 * Creative Thesis (Creative Compiler 2.0 Milestone 3) — the protected structured
 * campaign-truth contract that replaces the ~1000-char prose sourceDetail blob.
 * Proves it carries the fields genomeConstraintBlock dropped, never invents
 * unknowns, and lets a later stage detect a silently-swapped protected field.
 */
import { describe, it, expect } from "vitest";
import {
  lockCreativeThesis,
  serializeThesisForPrompt,
  thesisPreservationViolations,
  CreativeThesisSchema,
  THESIS_PROTECTED_FIELDS,
} from "../lib/creativeThesis";
import type { CreativeGenome } from "../lib/creativeGenome";

const GENOME: CreativeGenome = {
  version: 1,
  objective: "save",
  audienceMoment: "The driver hit a pothole on Euclid Ave and the steering wheel no longer sits straight.",
  driverTension: "They cannot tell whether it is harmless or the start of an expensive problem.",
  mechanicTruth: "A crooked wheel after an impact can point to tire, wheel, alignment or suspension damage; only an inspection can tell which.",
  proprietaryProof: ["NHTSA - Tires: tread depth and safety guidance"],
  emotionalTurn: "Recognition, then relief at a clear next step.",
  visualMetaphor: "The vehicle walking in one straight shoe and one crooked shoe.",
  creativeTerritory: "road_villain",
  clevelandAngle: "Pothole season on Cleveland's east side arterials.",
  nickSignature: "Road-survival intelligence without panic or sales pressure.",
  desiredAction: "Save this and have the vehicle inspected if the symptom persists.",
};

describe("lockCreativeThesis", () => {
  it("carries the genome fields the sourceDetail blob DROPPED, and never invents unknowns", () => {
    const t = lockCreativeThesis(GENOME, { thesisId: "th_1", conceptId: "gen_1", heroSubject: "a crooked front wheel" });
    // fields genomeConstraintBlock dropped entirely — now preserved verbatim
    expect(t.mechanicTruth).toBe(GENOME.mechanicTruth);
    expect(t.customerTension).toBe(GENOME.driverTension);
    expect(t.premise).toBe(GENOME.audienceMoment);
    // fields it did carry, still exact
    expect(t.visualMetaphor).toBe(GENOME.visualMetaphor);
    expect(t.desiredAction).toBe(GENOME.desiredAction);
    expect(t.clevelandTexture).toEqual([GENOME.clevelandAngle]);
    expect(t.heroSubject).toBe("a crooked front wheel");
    // unknown-in-v1-genome fields stay EMPTY — honest, not fabricated
    expect(t.openingPromise).toBe("");
    expect(t.finalMeaning).toBe("");
    expect(t.memorableFrame).toBe("");
    expect(t.soundMotif).toBe("");
    // protection contract present + schema-valid
    expect(t.mustPreserve).toEqual([...THESIS_PROTECTED_FIELDS]);
    expect(t.conceptId).toBe("gen_1");
    expect(() => CreativeThesisSchema.parse(t)).not.toThrow();
  });

  it("omits Cleveland texture when the genome angle is empty (no fabrication)", () => {
    const t = lockCreativeThesis({ ...GENOME, clevelandAngle: "" } as CreativeGenome, { thesisId: "th_2", conceptId: "gen_2" });
    expect(t.clevelandTexture).toEqual([]);
  });
});

describe("serializeThesisForPrompt", () => {
  it("flags PRESERVE fields, states the never-introduce prohibitions, and omits empty lines", () => {
    const t = lockCreativeThesis(GENOME, { thesisId: "th_1", conceptId: "gen_1" });
    const s = serializeThesisForPrompt(t);
    expect(s).toContain("CREATIVE THESIS (LOCKED");
    expect(s).toContain("Mechanic truth [PRESERVE");
    expect(s).toContain(GENOME.mechanicTruth);
    expect(s).toContain("Visual metaphor [PRESERVE]");
    expect(s).toContain("Desired action [PRESERVE]");
    expect(s).toContain("NEVER introduce");
    expect(s).toContain("faceless contract");
    // an empty field (heroSubject not supplied) produces no line
    expect(s).not.toContain("Hero subject:");
  });
});

describe("thesisPreservationViolations", () => {
  it("flags a silently-replaced mechanic truth", () => {
    const t = lockCreativeThesis(GENOME, { thesisId: "th_1", conceptId: "gen_1" });
    expect(thesisPreservationViolations(t, { mechanicTruth: "a totally different fabricated fact" })).toEqual(["mechanicTruth"]);
  });

  it("catches a silently swapped winner (conceptId)", () => {
    const t = lockCreativeThesis(GENOME, { thesisId: "th_1", conceptId: "gen_1" });
    expect(thesisPreservationViolations(t, { conceptId: "gen_HIJACKED" })).toEqual(["conceptId"]);
  });

  it("is clean when protected fields are unchanged", () => {
    const t = lockCreativeThesis(GENOME, { thesisId: "th_1", conceptId: "gen_1" });
    expect(thesisPreservationViolations(t, { mechanicTruth: GENOME.mechanicTruth, visualMetaphor: GENOME.visualMetaphor })).toEqual([]);
    expect(thesisPreservationViolations(t, {})).toEqual([]);
  });
});
