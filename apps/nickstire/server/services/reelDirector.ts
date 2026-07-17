/**
 * Reel Director — Genome Wave 2, slice 1.
 *
 * The first format director: turns ONE campaign genome into a full,
 * quality-scored ReelBrief through the EXISTING generator (master prompt +
 * critic + evidence engine + performance feedback), replacing the copy-paste
 * seed-string handoff from Wave 1. The genome constrains the generation —
 * topic, suggested archetype, campaign keyword, and a constraint block in
 * sourceDetail — but the generator keeps its own craft (beats, VO, captions).
 *
 * Deliberately NO new prompt machinery: the director maps genome -> the
 * generator's existing input contract. Rendering stays behind the operator's
 * explicit enqueue tap; publishing stays behind the approve gate.
 */
import {
  CAMPAIGN_KEYWORDS,
  calculateReelQualityScore,
  type CampaignKeyword,
  type QualityScoreResult,
  type ReelBrief,
} from "../../client/src/lib/facelessReelStudio";
import { genomeToReelSeed, type CreativeGenome } from "../../client/src/lib/creativeGenome";
import { createLogger } from "../lib/logger";

const log = createLogger("services:reel-director");

/**
 * Extract the campaign keyword the genome asks for. Priority:
 * 1. An explicit `DM "X"` in desiredAction where X is a registry keyword.
 * 2. Any registry keyword mentioned anywhere in the genome's text fields
 *    (longest match first, so TIRES doesn't shadow a more specific ask).
 * Returns undefined when nothing matches — the generator then picks its own.
 */
export function campaignKeywordFromGenome(genome: CreativeGenome): CampaignKeyword | undefined {
  const dmMatch = genome.desiredAction.match(/DM\s+["']?([A-Za-z]+)["']?/i);
  if (dmMatch) {
    const candidate = dmMatch[1].toUpperCase();
    if ((CAMPAIGN_KEYWORDS as readonly string[]).includes(candidate)) return candidate as CampaignKeyword;
  }
  const haystack = [
    genome.audienceMoment,
    genome.driverTension,
    genome.mechanicTruth,
    genome.visualMetaphor,
    genome.desiredAction,
  ]
    .join(" ")
    .toUpperCase();
  const byLength = [...CAMPAIGN_KEYWORDS].sort((a, b) => b.length - a.length);
  for (const kw of byLength) {
    if (new RegExp(`\\b${kw}\\b`).test(haystack)) return kw;
  }
  return undefined;
}

/**
 * The genome's creative constraints, packed into the generator's existing
 * sourceDetail channel (1000-char budget on the endpoint). This is how the
 * campaign's shared metaphor, emotional turn, and signature reach the brief
 * without new prompt-builder surgery.
 */
export function genomeConstraintBlock(genome: CreativeGenome): string {
  const seed = genomeToReelSeed(genome);
  const proof = genome.proprietaryProof.length
    ? `Proof handles: ${genome.proprietaryProof.slice(0, 3).join("; ")}.`
    : "";
  return [
    `CAMPAIGN GENOME CONSTRAINTS (this reel is one format of a multi-format campaign):`,
    `Shared visual metaphor: ${genome.visualMetaphor}.`,
    `Emotional turn: ${genome.emotionalTurn}.`,
    `Nick signature: ${genome.nickSignature}.`,
    `Cleveland angle: ${genome.clevelandAngle}.`,
    `Desired action: ${genome.desiredAction}.`,
    `Suggested motion lens: ${seed.motionLens}.`,
    proof,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1000);
}

/**
 * Attach RESOLVED genome evidence as PROOF source notes when the model
 * emitted none. Hardened after #811 review: raw handle strings no longer
 * satisfy the grounding gate — only evidence the resolver verified (a real
 * 5-star review / declined work-order row, or an accepted public proof
 * family) is attached, and the note carries the resolved ASSERTION, not the
 * handle. Never overrides model-found proof; no-op when nothing resolved.
 */
export function attachResolvedProof(
  brief: ReelBrief,
  resolved: Array<{ assertion: string }>,
  mechanicTruth: string,
): ReelBrief {
  if (resolved.length === 0) return brief;
  if (brief.sourceNotes.some((s) => s.kind === "proof")) return brief;
  return {
    ...brief,
    sourceNotes: [
      ...brief.sourceNotes,
      ...resolved.slice(0, 2).map((r) => ({
        label: r.assertion.slice(0, 200),
        kind: "proof" as const,
        supports: mechanicTruth.slice(0, 200),
      })),
    ],
  };
}

export interface DraftReelFromGenomeResult {
  brief: ReelBrief;
  qualityScore: QualityScoreResult;
  campaignKeyword: CampaignKeyword | undefined;
  /** evidence accounting: what the resolver verified vs rejected */
  evidence: { attached: number; rejected: string[] };
}

/**
 * Genome -> full ReelBrief via the existing generator. Generation only:
 * no render, no enqueue, no posting.
 */
export async function draftReelFromGenome(genome: CreativeGenome): Promise<DraftReelFromGenomeResult> {
  const seed = genomeToReelSeed(genome);
  const campaignKeyword = campaignKeywordFromGenome(genome);
  // Milestone 3: lock a structured Creative Thesis from the genome and hand it to
  // the generator as a typed contract (not the lossy 1000-char sourceDetail
  // blob). conceptId is a deterministic per-genome lineage anchor (the v1 genome
  // carries no id). sourceDetail is kept only for the evidence-provenance channel.
  const { lockCreativeThesis } = await import("../../client/src/lib/creativeThesis");
  const { createHash, randomUUID } = await import("crypto");
  const conceptId = `gen_${createHash("sha1").update(`${genome.mechanicTruth}|${genome.visualMetaphor}`).digest("hex").slice(0, 12)}`;
  const thesis = lockCreativeThesis(genome, { thesisId: `thesis_${randomUUID()}`, conceptId });
  const { generateReelBriefAI } = await import("./reelBriefGen");
  const { brief: rawBrief } = await generateReelBriefAI({
    topic: seed.topic,
    archetype: seed.archetype,
    campaignKeyword,
    sourceType: "manual",
    sourceDetail: genomeConstraintBlock(genome),
    thesis,
  });
  const { resolveEvidenceRecords } = await import("./evidenceRecords");
  const resolution = await resolveEvidenceRecords(genome.proprietaryProof, genome.mechanicTruth);
  const brief = attachResolvedProof(rawBrief, resolution.records.map((r) => ({ assertion: r.assertion })), genome.mechanicTruth);
  if (brief !== rawBrief) log.info("resolved genome evidence attached as proof notes", { attached: resolution.records.length });
  // Claim-level provenance rides the brief - a published asset can name its evidence.
  (brief as { evidenceRecords?: unknown }).evidenceRecords = resolution.records;
  const qualityScore = calculateReelQualityScore(brief);
  log.info("reel drafted from genome", {
    territory: genome.creativeTerritory,
    archetype: seed.archetype,
    campaignKeyword: campaignKeyword ?? "(generator's choice)",
    score: qualityScore.overall,
    passing: qualityScore.passing,
    evidenceRejected: resolution.rejected.length,
  });
  return {
    brief,
    qualityScore,
    campaignKeyword,
    evidence: { attached: brief === rawBrief ? 0 : resolution.records.slice(0, 2).length, rejected: resolution.rejected },
  };
}
