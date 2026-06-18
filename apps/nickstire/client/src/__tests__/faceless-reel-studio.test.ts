/**
 * Faceless Reel Intelligence Studio — helper/validator tests.
 *
 * Pins the V1 safety contracts: forbidden-claim detection, soft-language
 * allowance, the faceless rule, beat/length structure, score thresholds,
 * prompt completeness, and the publish/generation kill-switches.
 */
import { describe, it, expect } from "vitest";
import {
  PUBLISH_ENABLED,
  GENERATION_ENABLED,
  INSIGHTS_ENABLED,
  DISABLED_REASON,
  REEL_OUTPUT_RULES,
  STUDIO_DEFAULTS,
  detectForbiddenReelClaims,
  detectOverdiagnosis,
  detectFearmongering,
  detectGenericAdLanguage,
  detectPriceClaims,
  validateFacelessSubject,
  validateBeatCount,
  validateReelLengthTarget,
  validateMutedFirstClarity,
  validateLoopPlan,
  validateCampaignKeyword,
  validateSourceGrounding,
  validateNoExternalSideEffects,
  scoreReelConcept,
  calculateReelQualityScore,
  runSafetyChecks,
  buildHiggsfieldReelPromptPack,
  buildFfmpegChecklist,
  buildInstagramPublishChecklist,
  buildArchiveChecklist,
  buildRepetitionChecks,
  canPublish,
  canGenerateVideo,
  canAssembleMp4,
  canReadInsights,
  SOFT_DIAGNOSTIC_ALLOWED,
} from "../lib/facelessReelStudio";
import { buildFacelessReelSystemPrompt } from "../lib/facelessReelStudioPrompt";
import { SAMPLE_REEL_BRIEFS } from "../lib/facelessReelStudioSamples";

const sample = () => SAMPLE_REEL_BRIEFS[0];

describe("claim safety detectors", () => {
  it("blocks forbidden claims (free / guarantee / best / in stock / urgency / wait times)", () => {
    expect(detectForbiddenReelClaims("Free rotation with every visit")).not.toHaveLength(0);
    expect(detectForbiddenReelClaims("We guarantee the fix")).not.toHaveLength(0);
    expect(detectForbiddenReelClaims("Best in Cleveland, period")).not.toHaveLength(0);
    expect(detectForbiddenReelClaims("These tires are in stock now")).not.toHaveLength(0);
    expect(detectForbiddenReelClaims("Book now before it's too late")).not.toHaveLength(0);
    expect(detectForbiddenReelClaims("Done in 30 minutes")).not.toHaveLength(0);
  });

  it("blocks overdiagnosis and fearmongering", () => {
    expect(detectOverdiagnosis("This means your rotor is shot")).not.toHaveLength(0);
    expect(detectOverdiagnosis("You definitely need new pads")).not.toHaveLength(0);
    expect(detectFearmongering("Your car is a death trap")).not.toHaveLength(0);
    expect(detectFearmongering("It's a time bomb waiting to explode")).not.toHaveLength(0);
  });

  it("warns on generic ad language", () => {
    const f = detectGenericAdLanguage("Hassle-free top-notch service from trusted experts");
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.severity === "warn")).toBe(true);
  });

  it("blocks ANY price-shaped text in reel copy", () => {
    expect(detectPriceClaims("Brakes from $149 today")).toHaveLength(1);
    expect(detectPriceClaims("no numbers here")).toHaveLength(0);
  });

  it("ALLOWS every approved soft-diagnostic phrase", () => {
    for (const phrase of SOFT_DIAGNOSTIC_ALLOWED) {
      const text = `A squeal ${phrase} - stop by.`;
      expect(detectForbiddenReelClaims(text)).toHaveLength(0);
      expect(detectOverdiagnosis(text)).toHaveLength(0);
      expect(detectFearmongering(text)).toHaveLength(0);
    }
  });
});

describe("faceless contract", () => {
  it("rejects face/talking-head/shop-tour subjects", () => {
    expect(validateFacelessSubject(["close-up of a person's face reacting"]).ok).toBe(false);
    expect(validateFacelessSubject(["mechanic talking head explains brakes"]).ok).toBe(false);
    expect(validateFacelessSubject(["a shop tour of our bays"]).ok).toBe(false);
  });

  it("accepts object-character subjects", () => {
    expect(
      validateFacelessSubject([
        "extreme macro of a brake pad clamping a rotor",
        "a penny inspecting tread depth like a building inspector",
      ]).ok,
    ).toBe(true);
  });

  it("runSafetyChecks blocks a brief whose beat goes face-first", () => {
    const b = structuredClone(sample());
    b.storyboardBeats[0].visual = "a smiling mechanic talking head greets the camera";
    const report = runSafetyChecks(b, () => "t");
    expect(report.blocked).toBe(true);
    expect(report.findings.some((f) => f.rule === "no-human-face")).toBe(true);
  });
});

describe("structure validators", () => {
  it("enforces 4-6 contiguous beats", () => {
    const beats = sample().storyboardBeats;
    expect(validateBeatCount(beats).ok).toBe(true);
    expect(validateBeatCount(beats.slice(0, 3)).ok).toBe(false);
    const gappy = structuredClone(beats);
    gappy[2].startSecond += 1; // open a gap
    expect(validateBeatCount(gappy).ok).toBe(false);
  });

  it("enforces the 15-22 second band", () => {
    expect(validateReelLengthTarget(sample().storyboardBeats).ok).toBe(true);
    const short = structuredClone(sample().storyboardBeats).map((b) => ({ ...b, startSecond: b.startSecond / 2, endSecond: b.endSecond / 2 }));
    expect(validateReelLengthTarget(short).ok).toBe(false);
    const long = structuredClone(sample().storyboardBeats);
    long[long.length - 1].endSecond = REEL_OUTPUT_RULES.maxSeconds + 5;
    expect(validateReelLengthTarget(long).ok).toBe(false);
  });

  it("muted-first clarity requires on-screen text on every beat", () => {
    expect(validateMutedFirstClarity(sample().storyboardBeats).ok).toBe(true);
    const silent = structuredClone(sample().storyboardBeats);
    silent[1].onScreenText = "  ";
    expect(validateMutedFirstClarity(silent).ok).toBe(false);
  });

  it("loop plan + keyword + source grounding", () => {
    expect(validateLoopPlan("last frame hands back to the first")).toEqual({ ok: true });
    expect(validateLoopPlan(" ").ok).toBe(false);
    expect(validateCampaignKeyword("BRAKES").ok).toBe(true);
    expect(validateCampaignKeyword("brakes").ok).toBe(false);
    expect(validateCampaignKeyword("NOTAKEYWORD").ok).toBe(false);
    expect(validateSourceGrounding(sample()).ok).toBe(true);
    expect(validateSourceGrounding({ mechanicTruth: "x", sourceNotes: [] }).ok).toBe(false);
  });
});

describe("scoring", () => {
  it("concept scoring clamps to 0-10 per dimension and applies the threshold", () => {
    const winner = sample().concepts.find((c) => c.id === sample().winningConceptId)!;
    const s = scoreReelConcept(winner);
    expect(s.total).toBeGreaterThanOrEqual(STUDIO_DEFAULTS.conceptMinScore);
    expect(s.passing).toBe(true);
    const wild = structuredClone(winner);
    wild.scores.hook = 99; // clamped to 10
    expect(scoreReelConcept(wild).total).toBeLessThanOrEqual(60);
  });

  it("every SAMPLE brief passes the 75-point quality gate", () => {
    for (const brief of SAMPLE_REEL_BRIEFS) {
      const q = calculateReelQualityScore(brief);
      expect(q.max).toBe(75);
      expect(q.passing, `${brief.id}: ${JSON.stringify(q.parts.filter((p) => !p.ok))}`).toBe(true);
    }
  });

  it("a forbidden claim drops the gate below passing behavior (claim part fails)", () => {
    const b = structuredClone(sample());
    b.selectedCaption = "We guarantee the best in Cleveland, free for everyone";
    const q = calculateReelQualityScore(b);
    const claimPart = q.parts.find((p) => p.label.startsWith("Claim safety"))!;
    expect(claimPart.ok).toBe(false);
  });
});

describe("prompt engine", () => {
  it("master prompt contains the required sections", () => {
    const p = buildFacelessReelSystemPrompt({ mode: "asset_prep", factBucket: "myth_buster" });
    for (const section of [
      "# ROLE",
      "# BUSINESS FACTS",
      "# PROPRIETARY SHOP EVIDENCE",
      "# HIDDEN PERSUASION",
      "# RESEARCH STANDARD",
      "# FORMAT CONTRACT",
      "# FACT BUCKETS",
      "# ARCHETYPES",
      "# MOTION LENSES",
      "# OBJECT CHARACTERS",
      "# CONCEPT IDEATION",
      "# SCORING RUBRIC",
      "# STORYBOARD STRUCTURE",
      "# HIGGSFIELD REQUIREMENTS",
      "# FFMPEG REQUIREMENTS",
      "# CAPTION STRUCTURE",
      "# CLAIM SAFETY",
      "# QUALITY GATE",
      "# PUBLISH + ARCHIVE CHECKLISTS",
      "# ABORT CONDITIONS",
      "# THIS RUN",
    ]) {
      expect(p, `missing ${section}`).toContain(section);
    }
    expect(p).toContain("FACELESS");
    expect(p).toContain("15-22 seconds");
  });

  it("threads proprietary evidence when provided", () => {
    const p = buildFacelessReelSystemPrompt({
      mode: "draft",
      proprietaryEvidence: {
        recentCaseStudy: {
          vehicle: "2019 Tesla Model 3",
          symptom: "noise",
          failedComponent: "control arm",
          condition: "red",
          techNotes: "torn bushing",
          recommendedAction: "replace link",
        },
        localStats: {
          brakeRustRatioPercent: 88,
          potholeDamageCount: 99,
          commonVehicles: ["Tesla Model 3"],
          averageMileage: 50000,
        },
        clevelandAngle: "Cleveland winters are brutal.",
      },
    });
    expect(p).toContain("2019 Tesla Model 3");
    expect(p).toContain("88%");
    expect(p).toContain("99 incidents");
    expect(p).toContain("Cleveland winters are brutal.");
  });

  it("prompt honors overrides and avoid-lists", () => {
    const p = buildFacelessReelSystemPrompt({
      topicOverride: "winter tire pressure drop",
      campaignKeywordOverride: "PRESSURE",
      avoidRecentTopics: ["brake squeal"],
      avoidRecentStyles: ["diagnostic HUD"],
    });
    expect(p).toContain("winter tire pressure drop");
    expect(p).toContain("PRESSURE");
    expect(p).toContain("brake squeal");
    expect(p).toContain("diagnostic HUD");
  });
});

describe("builders", () => {
  it("Higgsfield pack: one prompt per beat, faceless negatives, safe zones", () => {
    const pack = buildHiggsfieldReelPromptPack(sample());
    expect(pack).toHaveLength(sample().storyboardBeats.length);
    for (const p of pack) {
      expect(p.negativePrompt).toContain("human face");
      expect(p.prompt).toContain("9:16");
      expect(p.safeZoneGuidance.length).toBeGreaterThan(0);
    }
  });

  it("ffmpeg checklist carries the output contract and never executes anything", () => {
    const items = buildFfmpegChecklist(sample());
    const spec = items.find((i) => i.label === "Output container/codec")!;
    expect(spec.detail).toContain("yuv420p");
    expect(spec.detail).toContain("+faststart");
    expect(items.some((i) => i.detail.includes("NOT executed"))).toBe(true);
  });

  it("publish checklist ends enabled; archive checklist exists", () => {
    const pub = buildInstagramPublishChecklist(sample());
    const gate = pub.find((i) => i.label === "Publish button")!;
    expect(gate.ok).toBe(true);
    expect(gate.detail).toBe(DISABLED_REASON);
    expect(buildArchiveChecklist(sample()).length).toBeGreaterThan(3);
  });

  it("repetition checks flag exact reuse", () => {
    const r = buildRepetitionChecks(sample(), {
      topics: [sample().topic],
      keywords: ["PRESSURE"],
      archetypes: [],
      motionLenses: [],
      objectCharacters: [],
    });
    expect(r.topicRepeated).toBe(true);
    expect(r.keywordRepeated).toBe(sample().campaignKeyword === "PRESSURE");
    expect(r.archetypeRepeated).toBe(false);
  });
});

// These constants/gates are CLIENT-SIDE UI affordances only — they cannot reach
// Instagram. The REAL publish safety is the server gate (REEL_PUBLISH_ENABLED
// default-OFF + full claim-safety), proven in server/socialPublish.reelGate.test.ts.
describe("client studio UI flags (publish safety is enforced server-side)", () => {
  it("exposes the studio's UI gates", () => {
    expect(PUBLISH_ENABLED).toBe(true);
    expect(GENERATION_ENABLED).toBe(true);
    expect(INSIGHTS_ENABLED).toBe(true);
    for (const gate of [canPublish(), canGenerateVideo(), canAssembleMp4(), canReadInsights()]) {
      expect(gate.ok).toBe(true);
    }
    expect(validateNoExternalSideEffects().ok).toBe(true);
  });

  it("samples never claim to be published and fabricate no URLs", () => {
    for (const b of SAMPLE_REEL_BRIEFS) {
      expect(b.isSample).toBe(true);
      expect(b.instagramUrl).toBeNull();
      expect(b.status).not.toBe("published_manual");
      for (const s of b.sourceNotes) expect(s.url).toBeUndefined();
    }
  });
});
