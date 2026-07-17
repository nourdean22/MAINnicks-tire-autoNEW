/**
 * Creative Compiler 2.0 Milestone 4 — winner survives into the genome.
 * The archaeology found ZERO tournament-winner fields survived into the genome
 * (conceptTournament.ts flattened the winner to prose and the LLM re-derived
 * everything). winnerSeed FORCES the winner's identity fields over any LLM drift.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.doUnmock("./_core/llm");
  vi.resetModules();
});

// A schema-valid, claim-safe genome the LLM "returns" that DRIFTS from the winner
// on all three identity fields — exactly the silent-replacement failure mode.
const DRIFTED = {
  version: 1,
  objective: "save",
  audienceMoment: "The dashboard battery light just came on during the school run.",
  driverTension: "They cannot tell if it is urgent or can wait until the weekend.",
  mechanicTruth: "An LLM-invented mechanic fact that ignores the winning concept entirely.",
  proprietaryProof: [],
  emotionalTurn: "An LLM-drifted emotional arc that is not the winner's.",
  visualMetaphor: "An LLM-drifted visual that is not the winning idea at all.",
  creativeTerritory: "road_villain",
  clevelandAngle: "Cleveland winters on the east side arterials.",
  nickSignature: "Calm, local, inspection-first with zero sales pressure.",
  desiredAction: "Save this and have it checked if it persists.",
};

const WINNER_SEED = {
  visualMetaphor: "the battery as a slowly draining hourglass",
  mechanicTruth: "Summer heat degrades the battery; the first cold snap is what finally reveals it.",
  emotionalTurn: "from blaming the car this morning to a simple seasonal check",
};

describe("generateCampaignGenome winnerSeed force (Milestone 4)", () => {
  it("FORCES the judged winner's identity fields over the LLM's drift", async () => {
    const spy = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(DRIFTED) } }] });
    vi.doMock("./_core/llm", () => ({ invokeLLM: spy }));
    vi.resetModules();
    const { generateCampaignGenome } = await import("./services/genomeGen");

    const { genome } = await generateCampaignGenome({
      campaignAsk: "battery dies on the first cold Cleveland morning",
      winnerSeed: WINNER_SEED,
    });

    // the WINNER survives — not the LLM's drifted values
    expect(genome.visualMetaphor).toBe(WINNER_SEED.visualMetaphor);
    expect(genome.mechanicTruth).toBe(WINNER_SEED.mechanicTruth);
    expect(genome.emotionalTurn).toBe(WINNER_SEED.emotionalTurn);
    // the LLM's genuine-gap fields are kept
    expect(genome.clevelandAngle).toBe(DRIFTED.clevelandAngle);
    expect(genome.creativeTerritory).toBe(DRIFTED.creativeTerritory);
    expect(genome.audienceMoment).toBe(DRIFTED.audienceMoment);
  });

  it("without a winnerSeed, the LLM genome passes through unchanged (back-compat)", async () => {
    const spy = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(DRIFTED) } }] });
    vi.doMock("./_core/llm", () => ({ invokeLLM: spy }));
    vi.resetModules();
    const { generateCampaignGenome } = await import("./services/genomeGen");

    const { genome } = await generateCampaignGenome({ campaignAsk: "battery topic" });
    expect(genome.visualMetaphor).toBe(DRIFTED.visualMetaphor);
    expect(genome.mechanicTruth).toBe(DRIFTED.mechanicTruth);
    expect(genome.emotionalTurn).toBe(DRIFTED.emotionalTurn);
  });
});
