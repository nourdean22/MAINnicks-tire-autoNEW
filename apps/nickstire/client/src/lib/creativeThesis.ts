/**
 * Creative Thesis (Creative Compiler 2.0 Milestone 3).
 *
 * The PROTECTED, structured campaign-truth contract that every downstream format
 * director receives — replacing the ~1000-char prose "sourceDetail" blob that
 * flattened the genome. reelDirector.genomeConstraintBlock packed 7 fields into
 * a space-joined string capped at 1000 chars and dropped `objective`,
 * `audienceMoment`, `driverTension`, `mechanicTruth`, and `creativeTerritory`
 * ENTIRELY — so the brief generator invented its own mechanic truth instead of
 * being anchored to the approved one.
 *
 * Doctrine (from the directive): the compiler must NOT invent missing fields —
 * unknown stays unknown (empty string / empty array), never fabricated. Fields
 * named in `mustPreserve` may not be replaced by any downstream LLM call;
 * `mayAdapt` are executional; `mustNeverIntroduce` are the hard prohibitions
 * (generated lettering/logos, human faces/hands) carried into every compilation.
 */
import { z } from "zod";
import type { CreativeGenome } from "./creativeGenome";

export const CREATIVE_THESIS_VERSION = 1 as const;

export const CreativeThesisSchema = z.object({
  version: z.literal(CREATIVE_THESIS_VERSION),
  thesisId: z.string().min(1),
  /** the tournament winner / genome the thesis descends from — PROTECTED */
  conceptId: z.string(),
  premise: z.string(),
  /** the core teaching fact — PROTECTED, never restated as a different fact */
  mechanicTruth: z.string(),
  customerTension: z.string(),
  openingPromise: z.string(),
  emotionalTurn: z.string(),
  finalMeaning: z.string(),
  heroSubject: z.string(),
  /** the metaphor doing the teaching work — PROTECTED */
  visualMetaphor: z.string(),
  memorableFrame: z.string(),
  soundMotif: z.string(),
  nickSignature: z.string(),
  clevelandTexture: z.array(z.string()),
  /** the customer action — PROTECTED */
  desiredAction: z.string(),
  mustPreserve: z.array(z.string()),
  mayAdapt: z.array(z.string()),
  mustNeverIntroduce: z.array(z.string()),
});
export type CreativeThesis = z.infer<typeof CreativeThesisSchema>;

/** Field VALUES no downstream call may replace once the thesis is locked. */
export const THESIS_PROTECTED_FIELDS = ["conceptId", "mechanicTruth", "visualMetaphor", "desiredAction"] as const;
export type ThesisProtectedField = (typeof THESIS_PROTECTED_FIELDS)[number];

/** Executional fields a downstream director may legitimately shape. */
export const THESIS_ADAPTABLE_FIELDS = ["premise", "openingPromise", "emotionalTurn", "finalMeaning", "memorableFrame", "soundMotif", "heroSubject"] as const;

/** The hard prohibitions carried into every downstream compilation (the 690001
 *  defect classes, stated as a contract the compiler enforces). */
export const THESIS_NEVER_INTRODUCE = [
  "generated on-screen text, letters, words, numbers, or device readouts",
  "generated brand names, logos, signage, or the Nick's wordmark",
  "human faces, hands, gloves, arms, or people (faceless contract)",
] as const;

/**
 * Lock a Creative Thesis from an approved genome. Grounded fields are copied
 * verbatim; fields the v1 genome does not carry (openingPromise, finalMeaning,
 * memorableFrame, soundMotif) stay EMPTY — honest unknown, never invented. The
 * caller supplies a stable thesisId and the winner/genome conceptId.
 */
export function lockCreativeThesis(
  genome: CreativeGenome,
  opts: { thesisId: string; conceptId: string; heroSubject?: string },
): CreativeThesis {
  const thesis: CreativeThesis = {
    version: CREATIVE_THESIS_VERSION,
    thesisId: opts.thesisId,
    conceptId: opts.conceptId,
    premise: genome.audienceMoment,
    mechanicTruth: genome.mechanicTruth,
    customerTension: genome.driverTension,
    openingPromise: "",
    emotionalTurn: genome.emotionalTurn,
    finalMeaning: "",
    heroSubject: opts.heroSubject ?? "",
    visualMetaphor: genome.visualMetaphor,
    memorableFrame: "",
    soundMotif: "",
    nickSignature: genome.nickSignature,
    clevelandTexture: genome.clevelandAngle ? [genome.clevelandAngle] : [],
    desiredAction: genome.desiredAction,
    mustPreserve: [...THESIS_PROTECTED_FIELDS],
    mayAdapt: [...THESIS_ADAPTABLE_FIELDS],
    mustNeverIntroduce: [...THESIS_NEVER_INTRODUCE],
  };
  return CreativeThesisSchema.parse(thesis);
}

/**
 * Readable representation for the generation prompt. The STRUCTURED thesis stays
 * the application contract (never a prose blob); this is only the human-readable
 * view the LLM reads, with the protected fields explicitly flagged so the model
 * develops an EXECUTION of the concept rather than replacing it.
 */
export function serializeThesisForPrompt(t: CreativeThesis): string {
  const lines: Array<string | false> = [
    `CREATIVE THESIS (LOCKED — this is ONE execution of an already-approved campaign concept; DEVELOP it, do NOT invent a new concept or a different mechanic truth):`,
    !!t.premise && `Premise: ${t.premise}`,
    `Mechanic truth [PRESERVE — do not restate as a different fact]: ${t.mechanicTruth}`,
    !!t.customerTension && `Customer tension: ${t.customerTension}`,
    !!t.emotionalTurn && `Emotional turn: ${t.emotionalTurn}`,
    `Visual metaphor [PRESERVE]: ${t.visualMetaphor}`,
    !!t.heroSubject && `Hero subject: ${t.heroSubject}`,
    !!t.nickSignature && `Nick's signature: ${t.nickSignature}`,
    t.clevelandTexture.length > 0 && `Cleveland texture: ${t.clevelandTexture.join("; ")}`,
    `Desired action [PRESERVE]: ${t.desiredAction}`,
    `NEVER introduce: ${t.mustNeverIntroduce.join("; ")}.`,
  ];
  return lines.filter((l): l is string => typeof l === "string").join("\n");
}

/**
 * Compare a downstream-produced candidate against the locked thesis and return
 * the protected fields whose VALUE was changed (empty = clean). Used by later
 * milestones (field-level critic patches, preflight) to REJECT a rewrite that
 * silently replaced campaign truth. Comparison is exact-string on protected
 * fields only; adaptable fields are ignored.
 */
export function thesisPreservationViolations(
  locked: CreativeThesis,
  candidate: Partial<Record<ThesisProtectedField, string>>,
): ThesisProtectedField[] {
  const violations: ThesisProtectedField[] = [];
  for (const field of THESIS_PROTECTED_FIELDS) {
    const proposed = candidate[field];
    if (proposed !== undefined && proposed.trim() !== locked[field].trim()) {
      violations.push(field);
    }
  }
  return violations;
}
