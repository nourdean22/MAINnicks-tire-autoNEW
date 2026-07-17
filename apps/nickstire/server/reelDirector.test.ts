/**
 * Reel Director (Genome Wave 2, slice 1) — genome -> full ReelBrief through
 * the existing generator. Verifies the genome->generator input mapping and
 * the campaign-keyword extraction, with the LLM call mocked.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  campaignKeywordFromGenome,
  genomeConstraintBlock,
  draftReelFromGenome,
  withGenomeProof,
} from "./services/reelDirector";
import { validateSourceGrounding } from "../client/src/lib/facelessReelStudio";
import { creativeGenomeSchema, type CreativeGenome } from "../client/src/lib/creativeGenome";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";

const baseGenome: CreativeGenome = creativeGenomeSchema.parse({
  version: 1,
  objective: "save",
  audienceMoment: "First hard freeze hits and the battery quits in the driveway",
  driverTension: "Drivers assume a slow crank is normal cold-weather behavior",
  mechanicTruth: "Cold cuts battery cranking power roughly in half; a weak battery shows itself first on freezing mornings",
  proprietaryProof: ["review:rev_123", "work_order:wo_456"],
  emotionalTurn: "dread turns into a two-minute check",
  visualMetaphor: "the battery as a hibernating animal that may not wake",
  creativeTerritory: "weather_local_alert",
  clevelandAngle: "Lake-effect cold snaps hit Euclid harder than the forecast says",
  nickSignature: "road-survival intelligence without panic",
  desiredAction: 'save this and DM "BATTERY" before the freeze',
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("./services/reelBriefGen");
  vi.resetModules();
});

describe("campaignKeywordFromGenome", () => {
  it("extracts an explicit DM keyword from desiredAction", () => {
    expect(campaignKeywordFromGenome(baseGenome)).toBe("BATTERY");
  });

  it("falls back to scanning genome text when the DM keyword is not in the registry", () => {
    const g = { ...baseGenome, desiredAction: 'DM "FREEZE" for the checklist' };
    expect(campaignKeywordFromGenome(g)).toBe("BATTERY"); // found in mechanicTruth/audienceMoment
  });

  it("prefers the longest registry keyword when several appear", () => {
    const g = {
      ...baseGenome,
      desiredAction: "stop by the shop",
      audienceMoment: "New tires but the vibration at highway speed never left",
      driverTension: "Wheel shake blamed on the road, not the balance",
      mechanicTruth: "Vibration after new tires usually means balancing, not defects",
      visualMetaphor: "a coin standing on the dash, trembling",
    };
    expect(campaignKeywordFromGenome(g)).toBe("VIBRATION");
  });

  it("returns undefined when no registry keyword appears anywhere", () => {
    const g = {
      ...baseGenome,
      desiredAction: "stop by the shop this week",
      audienceMoment: "Something feels off about the car on cold mornings",
      driverTension: "Nobody can name what changed since the cold arrived",
      mechanicTruth: "A quick multi-point look finds the cause faster than guessing",
      visualMetaphor: "a flashlight sweeping a dark garage",
    };
    expect(campaignKeywordFromGenome(g)).toBeUndefined();
  });
});

describe("genomeConstraintBlock", () => {
  it("carries the campaign's shared creative constraints and the lens hint within budget", () => {
    const block = genomeConstraintBlock(baseGenome);
    expect(block).toContain(baseGenome.visualMetaphor);
    expect(block).toContain(baseGenome.nickSignature);
    expect(block).toContain("Suggested motion lens: weather_radar_overlay");
    expect(block).toContain("Proof handles: review:rev_123");
    expect(block.length).toBeLessThanOrEqual(1000);
  });

  it("omits the proof line when the genome has no proof handles", () => {
    const block = genomeConstraintBlock({ ...baseGenome, proprietaryProof: [] });
    expect(block).not.toContain("Proof handles");
  });
});

describe("withGenomeProof", () => {
  it("attaches genome proof handles when the model emitted no proof note (live-run 55/75 + 60/75 failure shape)", () => {
    const sample = SAMPLE_REEL_BRIEFS[0];
    const noProof = { ...sample, sourceNotes: sample.sourceNotes.filter((s) => s.kind !== "proof") };
    expect(validateSourceGrounding(noProof).ok).toBe(false);
    const patched = withGenomeProof(noProof, baseGenome);
    expect(validateSourceGrounding(patched).ok).toBe(true);
    const attached = patched.sourceNotes.filter((s) => s.kind === "proof");
    expect(attached.length).toBe(2);
    expect(attached[0].label).toBe("review:rev_123");
    expect(attached[0].supports).toContain("Cold cuts battery cranking power");
  });

  it("never overrides model-found proof and no-ops for proofless genomes", () => {
    const sample = SAMPLE_REEL_BRIEFS[0];
    if (sample.sourceNotes.some((s) => s.kind === "proof")) {
      expect(withGenomeProof(sample, baseGenome)).toBe(sample);
    }
    const noProof = { ...sample, sourceNotes: sample.sourceNotes.filter((s) => s.kind !== "proof") };
    expect(withGenomeProof(noProof, { ...baseGenome, proprietaryProof: [] })).toBe(noProof);
  });
});

describe("draftReelFromGenome", () => {
  it("maps the genome onto the existing generator contract and scores the result", async () => {
    const sample = SAMPLE_REEL_BRIEFS[0];
    const spy = vi.fn().mockResolvedValue({ brief: sample, rawModel: "{}" });
    vi.doMock("./services/reelBriefGen", () => ({ generateReelBriefAI: spy }));
    vi.resetModules();
    const { draftReelFromGenome: draft } = await import("./services/reelDirector");

    const res = await draft(baseGenome);

    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0][0];
    expect(input.sourceType).toBe("manual");
    expect(input.archetype).toBe("cleveland_road_alert"); // weather_local_alert territory mapping
    expect(input.campaignKeyword).toBe("BATTERY");
    expect(input.topic).toContain(baseGenome.audienceMoment.slice(0, 40));
    expect(input.sourceDetail).toContain("CAMPAIGN GENOME CONSTRAINTS");
    expect(res.brief).toEqual(sample);
    expect(typeof res.qualityScore.overall).toBe("number");
    expect(typeof res.qualityScore.passing).toBe("boolean");
    expect(res.campaignKeyword).toBe("BATTERY");
  });
});

// Static integrity: the exported service used by the endpoint is the same
// module the mocked test exercised (guards against path drift).
it("service module exposes the endpoint's entry point", () => {
  expect(typeof draftReelFromGenome).toBe("function");
});
