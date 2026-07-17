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
 * Carousel flavor of the Reel Director's proof attachment, hardened the same
 * way: only RESOLVED evidence (verified DB row or accepted public proof
 * family) becomes a proof note, carrying the resolved assertion — raw handle
 * strings never satisfy the grounding gate. Never overrides model-found
 * proof; no-op when nothing resolved.
 */
export function attachResolvedProof(
  brief: CarouselBrief,
  resolved: Array<{ assertion: string }>,
  mechanicTruth: string,
): CarouselBrief {
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

export interface DraftCarouselFromGenomeResult {
  brief: CarouselBrief;
  boostScore: BoostScoreResult;
  /** evidence accounting: what the resolver verified vs rejected */
  evidence: { attached: number; rejected: string[] };
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
  const { resolveEvidenceHandles } = await import("./evidenceResolver");
  const resolution = await resolveEvidenceHandles(genome.proprietaryProof);
  const brief = attachResolvedProof(rawBrief, resolution.resolved, genome.mechanicTruth);
  if (brief !== rawBrief) log.info("resolved genome evidence attached as proof notes", { attached: resolution.resolved.length });
  const boostScore = calculateBoostScore(brief);
  log.info("carousel drafted from genome", {
    territory: genome.creativeTerritory,
    campaignKeyword: campaignKeyword ?? "(generator's choice)",
    slides: brief.slides.length,
    score: boostScore.score,
    passing: boostScore.passing,
    evidenceRejected: resolution.rejected.length,
  });
  return {
    brief,
    boostScore,
    evidence: { attached: brief === rawBrief ? 0 : resolution.resolved.slice(0, 2).length, rejected: resolution.rejected },
  };
}
