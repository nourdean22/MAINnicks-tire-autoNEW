/**
 * Carousel Director — Genome Wave 2, slice 2.
 *
 * Same shape as the Reel Director (#811): one campaign genome -> a full
 * boost-scored CarouselBrief through the EXISTING carousel generator (its own
 * master prompt + evidence engine), replacing the Wave-1 copy-paste seed. The
 * genome constrains topic, territory, campaign keyword, and the Cleveland
 * angle; the generator keeps its craft (5 slide roles, captions, concepts).
 *
 * Persistence is NOT here: the Studio card chains this draft into the
 * existing saveCarouselDraft endpoint (which also syncs the sheet), so the
 * result lands on the Draft Board where #807's "Render slides" button and the
 * publish path already live. No renders, no credits, no posting.
 */
import {
  calculateBoostScore,
  type BoostScoreResult,
  type CarouselBrief,
} from "../../client/src/lib/igCarouselStudio";
import { genomeToCarouselSeed, type CreativeGenome } from "../../client/src/lib/creativeGenome";
import { campaignKeywordFromGenome } from "./reelDirector";
import { createLogger } from "../lib/logger";

const log = createLogger("services:carousel-director");

/**
 * Carousel flavor of the Reel Director's proof attachment: the model
 * (correctly) refuses to fabricate evidence when the evidence engine finds
 * nothing, so attach the genome's operator-supplied proof handles as PROOF
 * source notes — only when the model emitted none, never overriding
 * model-found proof, no-op for proofless genomes.
 */
export function withGenomeProof(brief: CarouselBrief, genome: CreativeGenome): CarouselBrief {
  if (genome.proprietaryProof.length === 0) return brief;
  if (brief.sourceNotes.some((s) => s.kind === "proof")) return brief;
  return {
    ...brief,
    sourceNotes: [
      ...brief.sourceNotes,
      ...genome.proprietaryProof.slice(0, 2).map((label) => ({
        label: label.slice(0, 200),
        kind: "proof" as const,
        supports: genome.mechanicTruth.slice(0, 200),
      })),
    ],
  };
}

export interface DraftCarouselFromGenomeResult {
  brief: CarouselBrief;
  boostScore: BoostScoreResult;
}

/**
 * Genome -> full CarouselBrief via the existing generator. Generation only:
 * no slide renders, no draft persistence, no posting.
 */
export async function draftCarouselFromGenome(genome: CreativeGenome): Promise<DraftCarouselFromGenomeResult> {
  const seed = genomeToCarouselSeed(genome);
  const campaignKeyword = campaignKeywordFromGenome(genome);
  const { generateCarouselBriefAI } = await import("./carouselBriefGen");
  const { brief: rawBrief } = await generateCarouselBriefAI({
    topic: seed.topic,
    territory: seed.creativeTerritory,
    campaignKeyword,
    seasonLocalAngle: genome.clevelandAngle,
  });
  const brief = withGenomeProof(rawBrief, genome);
  if (brief !== rawBrief) log.info("genome proof handles attached as source notes", { count: genome.proprietaryProof.length });
  const boostScore = calculateBoostScore(brief);
  log.info("carousel drafted from genome", {
    territory: genome.creativeTerritory,
    campaignKeyword: campaignKeyword ?? "(generator's choice)",
    slides: brief.slides.length,
    score: boostScore.score,
    passing: boostScore.passing,
  });
  return { brief, boostScore };
}
