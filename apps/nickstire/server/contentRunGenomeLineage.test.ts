/**
 * Campaign-package lineage regression.
 *
 * The original Instagram audit defined content_run as the universal parent:
 * content_run -> genome/concept -> artifact -> inventory -> approval -> publish -> outcome.
 * Reel jobs already had the second half; these pins keep the Genome/Tournament
 * entry paths from silently escaping that root again.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sliceBlock } from "./testUtils/sourceBlock";

const ROUTER = readFileSync(path.join(__dirname, "routers", "content.ts"), "utf8");
const CARD = readFileSync(path.join(__dirname, "..", "client", "src", "components", "admin", "CampaignPackageCard.tsx"), "utf8");

describe("content_run is the Campaign Package root", () => {
  it("tournament and direct genome generation create a run before creative work", () => {
    const tournament = sliceBlock(ROUTER, "runConceptTournament: adminProcedure", "startContentExperiment:", { label: "content.runConceptTournament" });
    expect(tournament).toContain("createContentRun");
    expect(tournament).toContain("contentRunId");
    expect(tournament).toContain("campaign generation refused rather than escaping lineage");

    const genome = sliceBlock(ROUTER, "generateCampaignGenome: dbAdminProcedure", "saveCarouselDraft:", { label: "content.generateCampaignGenome" });
    expect(genome).toContain("createContentRun");
    expect(genome).toContain("genomeId: saved?.id ?? null");
    expect(genome).toContain("contentRunId");
  });

  it("both Genome Directors accept and return the same root", () => {
    const reel = sliceBlock(ROUTER, "draftReelFromGenome: adminProcedure", "draftCarouselFromGenome:", { label: "content.draftReelFromGenome" });
    const carousel = sliceBlock(ROUTER, "draftCarouselFromGenome: adminProcedure", "generateCampaignGenome:", { label: "content.draftCarouselFromGenome" });
    for (const src of [reel, carousel]) {
      expect(src).toContain("contentRunId: z.string().max(64).optional()");
      expect(src).toContain("input.contentRunId ?? await createContentRun");
      expect(src).toContain("contentRunId");
    }
  });

  it("reel enqueue cannot strip contentRunId at either zod or whitelist boundary", () => {
    const enqueue = sliceBlock(ROUTER, "enqueueReelJob: adminProcedure", "getReelJob:", { label: "content.enqueueReelJob" });
    expect(enqueue).toContain("contentRunId: z.string().max(64).nullable().optional()");
    expect(enqueue).toContain("contentRunId: (brief as any).contentRunId ?? null");
  });

  it("the operator UI carries one run through director -> enqueue/save", () => {
    expect(CARD).toContain("contentRunId: result.contentRunId");
    expect(CARD).toContain("draftAndSaveCarousel(result.genome, result.contentRunId)");
    expect(CARD).toContain("reelDraft.mutate({ genome: result.genome, contentRunId: result.contentRunId })");
  });

  it("carousel persistence advances the same run to a durable built draft", () => {
    const save = sliceBlock(ROUTER, "saveCarouselDraft: adminProcedure", "allReelDrafts:", { label: "content.saveCarouselDraft" });
    expect(save).toContain("RUN_STAGE.awaiting_approval");
    expect(save).toContain("IMPLEMENTATION_STATE.built");
    expect(save).toContain("carousel draft");
  });
});
