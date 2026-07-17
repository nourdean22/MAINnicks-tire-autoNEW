/**
 * Carousel Director (Genome Wave 2, slice 2) — genome -> full CarouselBrief
 * through the existing carousel generator, with the LLM call mocked. Mirrors
 * reelDirector.test.ts: input mapping + proof attachment red-green.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { attachResolvedProof, draftCarouselFromGenome } from "./services/carouselDirector";
import { creativeGenomeSchema, type CreativeGenome } from "../client/src/lib/creativeGenome";
import { validateSourceGrounding } from "../client/src/lib/igCarouselStudio";
import { SAMPLE_BRIEFS } from "../client/src/lib/igCarouselStudioSamples";

const baseGenome: CreativeGenome = creativeGenomeSchema.parse({
  version: 1,
  objective: "save",
  audienceMoment: "First hard freeze hits and the battery quits in the driveway",
  driverTension: "Drivers assume a slow crank is normal cold-weather behavior",
  mechanicTruth: "Cold cuts battery cranking power roughly in half; a weak battery shows itself first on freezing mornings",
  proprietaryProof: ["review:rev_123"],
  emotionalTurn: "dread turns into a two-minute check",
  visualMetaphor: "the battery as a hibernating animal that may not wake",
  creativeTerritory: "weather_local_alert",
  clevelandAngle: "Lake-effect cold snaps hit Euclid harder than the forecast says",
  nickSignature: "road-survival intelligence without panic",
  desiredAction: 'save this and DM "BATTERY" before the freeze',
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("./services/carouselBriefGen");
  vi.resetModules();
});

describe("attachResolvedProof (carousel)", () => {
  it("attaches RESOLVED assertions when the model emitted no proof note", () => {
    const sample = SAMPLE_BRIEFS[0];
    const noProof = { ...sample, sourceNotes: sample.sourceNotes.filter((s) => s.kind !== "proof") };
    expect(validateSourceGrounding(noProof).ok).toBe(false);
    const patched = attachResolvedProof(noProof, [{ assertion: "Grounded 5-Star Review by Sam: cold start fixed" }], baseGenome.mechanicTruth);
    expect(validateSourceGrounding(patched).ok).toBe(true);
    expect(patched.sourceNotes.filter((s) => s.kind === "proof").map((s) => s.label)).toEqual(["Grounded 5-Star Review by Sam: cold start fixed"]);
  });

  it("never overrides model-found proof and no-ops when nothing resolved", () => {
    const sample = SAMPLE_BRIEFS[0];
    if (sample.sourceNotes.some((s) => s.kind === "proof")) {
      expect(attachResolvedProof(sample, [{ assertion: "x" }], baseGenome.mechanicTruth)).toBe(sample);
    }
    const noProof = { ...sample, sourceNotes: sample.sourceNotes.filter((s) => s.kind !== "proof") };
    expect(attachResolvedProof(noProof, [], baseGenome.mechanicTruth)).toBe(noProof);
  });
});

describe("draftCarouselFromGenome", () => {
  it("maps the genome onto the existing generator contract and boost-scores the result", async () => {
    const sample = SAMPLE_BRIEFS[0];
    const spy = vi.fn().mockResolvedValue({ brief: sample, rawModel: "{}" });
    vi.doMock("./services/carouselBriefGen", () => ({ generateCarouselBriefAI: spy }));
    vi.resetModules();
    const { draftCarouselFromGenome: draft } = await import("./services/carouselDirector");

    const res = await draft(baseGenome);

    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0][0];
    expect(input.territory).toBe("weather_local_alert");
    expect(input.campaignKeyword).toBe("BATTERY");
    expect(input.topic).toContain("Teach:");
    expect(input.seasonLocalAngle).toBe(baseGenome.clevelandAngle);
    expect(res.brief.slides.length).toBe(sample.slides.length);
    expect(typeof res.boostScore.score).toBe("number");
    expect(typeof res.boostScore.passing).toBe("boolean");
  });
});

it("service module exposes the endpoint's entry point", () => {
  expect(typeof draftCarouselFromGenome).toBe("function");
});
