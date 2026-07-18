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
  validateNoInFrameText,
  facelessCleanSceneDirective,
  compileProviderScene,
  transformToProviderSafeScene,
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
  buildReelContinuityBlock,
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

  // Regression for reel 690001: gloved HANDS rendered despite the contract.
  it("rejects gloved/human hands, arms, and fingers as subjects", () => {
    expect(validateFacelessSubject(["gloved hands lift the brake rotor"]).ok).toBe(false);
    expect(validateFacelessSubject(["a mechanic's hand torques the lug nut"]).ok).toBe(false);
    expect(validateFacelessSubject(["bare fingers wipe the sensor"]).ok).toBe(false);
    expect(validateFacelessSubject(["hands install the caliper"]).ok).toBe(false);
    // A metaphorical "hands off" between shots must NOT false-positive.
    expect(validateFacelessSubject(["the tire hands off to the next shot"]).ok).toBe(true);
  });

  it("runSafetyChecks blocks a beat whose visual casts gloved hands", () => {
    const b = structuredClone(sample());
    b.storyboardBeats[0].visual = "gloved hands lift the rotor into frame";
    const report = runSafetyChecks(b, () => "t");
    expect(report.blocked).toBe(true);
    expect(report.findings.some((f) => f.rule === "no-human-face")).toBe(true);
  });
});

// Regression for reel 690001's garbled "FTD913" readout + "Nixs" logo: a beat
// that structurally requires rendered text/brand is caught at DESIGN time.
describe("in-frame text / branding gate", () => {
  it("validateNoInFrameText blocks readable-text and brand subjects", () => {
    expect(validateNoInFrameText(["diagnostic tester screen showing 12.6V"]).ok).toBe(false);
    expect(validateNoInFrameText(["macro of a battery with the part number stamped on it"]).ok).toBe(false);
    expect(validateNoInFrameText(["a glowing Nick's logo spins into view"]).ok).toBe(false);
    expect(validateNoInFrameText(["gauge showing the low reading"]).ok).toBe(false);
    expect(validateNoInFrameText(["silent-film intertitle card"]).ok).toBe(false);
  });

  it("validateNoInFrameText allows wordless, unbranded physical shots", () => {
    expect(validateNoInFrameText(["extreme macro of worn tire tread"]).ok).toBe(true);
    expect(validateNoInFrameText(["a rusted brake rotor turning slowly"]).ok).toBe(true);
    // 'sidewall number' names a number but does not ask to RENDER a readout.
    expect(validateNoInFrameText(["macro push into the sidewall number area"]).ok).toBe(true);
  });

  it("runSafetyChecks HARD-blocks a text-dependent beat, and it survives a high score", () => {
    const b = structuredClone(sample());
    b.storyboardBeats[0].visual = "a diagnostic scanner screen displays the fault reading";
    const report = runSafetyChecks(b, () => "t");
    expect(report.blocked).toBe(true);
    expect(report.findings.some((f) => f.rule === "no-in-frame-text")).toBe(true);
    // The scoring gate must FAIL even though only one 10-pt part is lost.
    const scored = calculateReelQualityScore(b);
    expect(scored.passing).toBe(false);
    expect(scored.gate).toBe("block");
  });

  it("a clean sample brief still passes both new gates", () => {
    const report = runSafetyChecks(sample(), () => "t");
    expect(report.findings.some((f) => f.rule === "no-in-frame-text")).toBe(false);
    expect(report.findings.some((f) => f.rule === "no-human-face")).toBe(false);
  });
});

describe("lens-aware clean-scene directive", () => {
  it("non-graphical lenses get the strict 'no readable text' directive", () => {
    const d = facelessCleanSceneDirective("xray_cutaway");
    expect(d).toContain("no readable text of any kind");
    expect(d).toContain("clean and unbranded");
  });

  it("glowing-display lenses keep the no-brand rule but allow abstract glyphs", () => {
    for (const lens of ["warning_light_world", "weather_radar_overlay", "blueprint_technical"]) {
      const d = facelessCleanSceneDirective(lens);
      // hard rule stays
      expect(d).toContain("No brand names");
      expect(d).toContain("no gloves");
      // but the lens's own indicator glows / sweeps are permitted
      expect(d).toContain("indicator glows");
      // the strict "screens dark" clause is NOT imposed on a glowing-display lens
      expect(d).not.toContain("angled away from camera");
    }
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
      expect(q.gate).toBe("pass");
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
  it("voiceover is a HARD requirement (three straight briefs shipped silent while it was optional)", () => {
    const p = buildFacelessReelSystemPrompt({ mode: "asset_prep", factBucket: "myth_buster" });
    expect(p).toContain("voiceoverScript is REQUIRED and must not be empty");
    expect(p).toContain("38-48 words");
    expect(p).not.toContain("optional VO");
  });

  it("master prompt contains the required sections", () => {
    const p = buildFacelessReelSystemPrompt({ mode: "asset_prep", factBucket: "myth_buster" });
    for (const section of [
      "# ROLE",
      "# BUSINESS FACTS",
      "# PROPRIETARY SHOP EVIDENCE",
      "# HIDDEN PERSUASION",
      "# RESEARCH STANDARD",
      "# VOICEOVER CONTRACT",
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

// Milestone 5: separate creative intent from the provider-safe scene at the
// compile boundary (the 3.4 fix), so even the ungated cron path is guarded.
describe("compileProviderScene", () => {
  it("passes a clean beat through unchanged", () => {
    const c = compileProviderScene("extreme macro of worn tire tread", "slow push in");
    expect(c.status).toBe("clean");
    expect(c.scene).toBe("extreme macro of worn tire tread");
    expect(c.findings).toEqual([]);
  });

  it("corrects a text-dependent beat with a provider-safe clause", () => {
    const c = compileProviderScene("a diagnostic scanner screen displays the fault reading", "hold");
    expect(c.status).toBe("corrected");
    expect(c.scene).toContain("provider-safe:");
    expect(c.scene).toContain("dark, off, or angled away");
    expect(c.findings.length).toBeGreaterThan(0);
  });

  it("corrects a beat that casts gloved hands", () => {
    const c = compileProviderScene("gloved hands lift the rotor into frame", "tilt up");
    expect(c.status).toBe("corrected");
    expect(c.scene).toContain("no people, faces, hands");
  });

  it("the pack exposes per-beat sceneStatus and neutralizes renderable tokens in the Subject (M6)", () => {
    const pack = buildHiggsfieldReelPromptPack(sample());
    for (const p of pack) {
      expect(p.sceneStatus).toBeDefined();
      expect(p.prompt).toContain("Subject:");
    }
    // sample beat 1's visual carries a quoted 'MAX PRESS 44 PSI' label — M6 removes
    // it from the provider Subject so the generator has no text to mis-spell.
    expect(pack[0].sceneStatus).toBe("corrected");
    expect(pack[0].prompt).not.toContain("MAX PRESS 44 PSI");
  });

  it("a genuinely wordless beat stays clean and passes through unchanged", () => {
    const c = compileProviderScene("extreme macro of a rusted brake rotor turning slowly", "slow orbit");
    expect(c.status).toBe("clean");
    expect(c.scene).toBe("extreme macro of a rusted brake rotor turning slowly");
  });
});

// Milestone 6: zero generated lettering — the 690001 regression corpus.
describe("transformToProviderSafeScene", () => {
  it("removes a fake alphanumeric readout code (the FTD913 class)", () => {
    const out = transformToProviderSafeScene("a car battery stamped FTD913 on the case");
    expect(out).not.toContain("FTD913");
    expect(out).toContain("battery");
  });

  it("removes a quoted on-screen label ('MAX PRESS 44 PSI')", () => {
    const out = transformToProviderSafeScene("a tire sidewall's embossed 'MAX PRESS 44 PSI' lettering");
    expect(out).not.toContain("MAX PRESS 44 PSI");
    expect(out).not.toContain("44 PSI");
    expect(out).toContain("sidewall");
  });

  it("unbrands a Nick's logo without garbling the sentence (the Nixs class)", () => {
    const out = transformToProviderSafeScene("the Nick's logo spins on the workshop wall");
    expect(out.toLowerCase()).not.toContain("nick");
    expect(out.toLowerCase()).not.toContain("logo");
    expect(out).toContain("unbranded surface");
    expect(out).toContain("wall");
  });

  it("strips measured readings (11.8V)", () => {
    const out = transformToProviderSafeScene("a tester needle near 11.8V");
    expect(out).not.toContain("11.8V");
  });

  it("leaves a wordless physical description untouched", () => {
    const clean = "extreme macro push into worn tire tread on wet asphalt";
    expect(transformToProviderSafeScene(clean)).toBe(clean);
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

  it("Higgsfield pack: text/brand bans are POSITIVE (no pink-elephant tokens in the DO-NOT list)", () => {
    // Regression for prod reel 690001 — garbled on-screen text + a mis-spelled
    // "Nixs" logo + gloved hands. Seedance has no negative param; naming
    // text/logo/watermark inside the compiled "DO NOT INCLUDE" string activated
    // those concepts. The fix: describe an empty, unbranded scene positively and
    // drop the backfiring tokens from the negative.
    const pack = buildHiggsfieldReelPromptPack(sample());
    for (const p of pack) {
      // The clean-scene directive rides in EVERY beat's positive prompt.
      expect(p.prompt).toContain("no readable text of any kind");
      expect(p.prompt).toContain("clean and unbranded");
      expect(p.prompt).toContain("no gloves");
      // The concept-activating tokens must NOT appear in the negative anymore.
      expect(p.negativePrompt).not.toContain("watermark");
      expect(p.negativePrompt).not.toContain("logo");
      expect(p.negativePrompt).not.toContain("warped letters");
      expect(p.negativePrompt).not.toContain("text artifacts");
      // The hands gap that let gloved hands through is now closed in both places.
      expect(p.negativePrompt).toContain("gloves");
    }
  });

  it("prompt compiler: style grammar is LENS-SPECIFIC, not one universal 85mm suffix", () => {
    const brief = sample();
    const blueprint = buildHiggsfieldReelPromptPack({ ...brief, motionLens: "blueprint_technical" });
    const clay = buildHiggsfieldReelPromptPack({ ...brief, motionLens: "claymation_stop_motion" });
    const hyper = buildHiggsfieldReelPromptPack({ ...brief, motionLens: "hyperreal_cinematic" });
    // Blueprint/claymation must NOT receive the premium-photography language that
    // used to be appended to every lens (it fought the style).
    for (const p of [...blueprint, ...clay]) {
      expect(p.prompt).not.toContain("85mm");
      expect(p.prompt).not.toContain("film grain");
    }
    expect(blueprint[0].prompt).toContain("Orthographic");
    expect(clay[0].prompt).toContain("stop-motion");
    // Hyperreal keeps the premium film language — that's where it belongs.
    expect(hyper[0].prompt).toContain("85mm");
    // Lens-specific breakers land in the negative prompt.
    expect(blueprint[0].negativePrompt).toContain("film grain");
    expect(clay[0].negativePrompt).toContain("photorealistic automotive surfaces");
  });

  it("prompt compiler: one identical continuity block in EVERY beat prompt", () => {
    const pack = buildHiggsfieldReelPromptPack(sample());
    const block = buildReelContinuityBlock(sample());
    expect(block).toContain("VISUAL CONTINUITY");
    expect(block).toContain("Never change the hero object's shape");
    for (const p of pack) expect(p.prompt).toContain(block);
  });

  it("prompt compiler: adjacent beats hand off composition; timing fits the fixed clip length", () => {
    const pack = buildHiggsfieldReelPromptPack(sample());
    expect(pack[0].prompt).toContain("strongest possible first frame");
    expect(pack[0].prompt).not.toContain("previous shot ended on");
    for (let i = 1; i < pack.length; i++) {
      // The prev-shot reference now carries the M6 provider-safe (token-neutralized)
      // form of the previous beat's visual, not the raw text.
      expect(pack[i].prompt).toContain(`previous shot ended on: ${transformToProviderSafeScene(sample().storyboardBeats[i - 1].visual)}`);
    }
    // Timing speaks the renderer truth per beat: 4s source, trim to storyboard
    // length, action completes before the settle window (trim - min(0.6, 20%)).
    for (const p of pack) expect(p.prompt).toContain("Generate a four-second source clip");
    const beats = sample().storyboardBeats;
    pack.forEach((p, i) => {
      const trim = Math.min(4, Math.max(0.8, beats[i].endSecond - beats[i].startSecond));
      const actionBy = Number((trim - Math.min(0.6, trim * 0.2)).toFixed(1));
      expect(p.prompt).toContain(`the first ${trim.toFixed(1)} seconds`);
      expect(p.prompt).toContain(`complete the primary action by ${actionBy} seconds`);
    });
    expect(pack[pack.length - 1].prompt).toContain("seamless loop");
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
    // Enabled button must NOT show the stale disabled reason; it reflects the live gate.
    expect(gate.detail).not.toBe(DISABLED_REASON);
    expect(gate.detail).toContain("server-gated");
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
