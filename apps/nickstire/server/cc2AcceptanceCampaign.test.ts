/**
 * Creative Compiler 2.0 — Milestone 13 acceptance campaign (deterministic).
 *
 * Two complementary batteries. (1) Per-stage gate checks that each compiler stage
 * behaves on a subject-appropriate fixture (the battery GENOME for the truth/
 * critic stages; the tire-pressure SAMPLE — a known preflight-clean full brief —
 * for the render-facing stages). (2) A SINGLE coherent battery brief carried
 * end-to-end through the render-facing stages (M10 preflight → M8 conditioning →
 * M12 workspace), self-validated against preflight — the true single-subject
 * chain (audit: the per-stage checks alone use mixed fixtures). Together they
 * prove the compiler chain works without spending a credit; the LIVE paid render
 * (real pixels + a live QA verdict) was the operator's final validation.
 */
import { describe, it, expect } from "vitest";
import { lockCreativeThesis, serializeThesisForPrompt } from "../client/src/lib/creativeThesis";
import {
  runReelPreflight,
  buildHiggsfieldReelPromptPack,
  buildDraftWorkspace,
  resolveConditioningMode,
  compileProviderScene,
  transformToProviderSafeScene,
} from "../client/src/lib/facelessReelStudio";
import { applyCriticPreservingTruth } from "./services/reelBriefGen";
import { orchestratePostQa } from "./services/postQaOrchestrator";
import type { CreativeGenome } from "../client/src/lib/creativeGenome";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";
import type { RenderedFinding } from "./services/renderedQa";

const GENOME: CreativeGenome = {
  version: 1,
  objective: "save",
  audienceMoment: "The battery cranked fine yesterday and is dead on the first cold Cleveland morning.",
  driverTension: "They cannot tell if it is the battery, the cold, or something worse.",
  mechanicTruth: "Summer heat quietly degrades a battery; the first hard cold snap is what finally exposes it.",
  proprietaryProof: ["review: cold-morning no-start"],
  emotionalTurn: "from blaming the cold to a simple seasonal battery check",
  visualMetaphor: "the battery as a slowly draining hourglass that empties faster in the cold",
  creativeTerritory: "road_villain",
  clevelandAngle: "Euclid Ave's first hard freeze after a hot summer",
  nickSignature: "seasonal, inspection-first, no fear-selling",
  desiredAction: "DM BATTERY for a free seasonal check",
};

describe("CC2 acceptance campaign — battery subject, full chain", () => {
  it("M3: the Creative Thesis preserves the campaign truth and carries the never-introduce contract", () => {
    const t = lockCreativeThesis(GENOME, { thesisId: "t1", conceptId: "gen_batt" });
    expect(t.mechanicTruth).toBe(GENOME.mechanicTruth);
    expect(t.visualMetaphor).toBe(GENOME.visualMetaphor);
    expect(serializeThesisForPrompt(t)).toContain("NEVER introduce");
    expect(serializeThesisForPrompt(t)).toContain("faceless contract");
  });

  it("M9: the critic cannot swap the mechanic truth", () => {
    const { effective, preserved } = applyCriticPreservingTruth(
      { mechanicTruth: GENOME.mechanicTruth, winningConceptId: "gen_batt" },
      { mechanicTruth: "a hallucinated different fact", winningConceptId: "hijacked" },
    );
    expect(effective.mechanicTruth).toBe(GENOME.mechanicTruth);
    expect(effective.winningConceptId).toBe("gen_batt");
    expect(preserved).toEqual(expect.arrayContaining(["mechanicTruth", "winningConceptId"]));
  });

  it("M6: a beat requesting FTD913 + a Nick's logo is neutralized in the provider scene", () => {
    const design = "a car battery stamped FTD913 with the Nick's logo on the case";
    // the transformed scene description carries none of the renderable tokens
    const out = transformToProviderSafeScene(design);
    expect(out).not.toContain("FTD913");
    expect(out.toLowerCase()).not.toContain("nick");
    expect(out.toLowerCase()).not.toMatch(/\blogo\b/);
    // and the compiled scene is flagged corrected (the corrective clause itself
    // legitimately mentions "no logos" — the token neutralization is on the scene)
    expect(compileProviderScene(design, "slow push in").status).toBe("corrected");
  });

  it("M10: preflight BLOCKS a diagnostic-screen beat before any spend, and PASSES a clean redesign", () => {
    const bad = structuredClone(SAMPLE_REEL_BRIEFS[0]);
    bad.storyboardBeats[0].visual = "a diagnostic scanner screen displays the battery voltage reading";
    expect(runReelPreflight(bad).status).toBe("block");
    // the clean sample redesign passes (warnings only)
    expect(runReelPreflight(SAMPLE_REEL_BRIEFS[0]).status).toBe("pass");
  });

  it("M8: with a hero frame the compiler uses shared-identity continuity (no contradiction)", () => {
    const withHero = {
      ...SAMPLE_REEL_BRIEFS[0],
      visualWorld: { style: "safe" as const, heroFrameUrl: "https://x/h.jpg", framePrompt: "fp", lockedInvariants: "operator-approved reference frame locked" },
    };
    expect(resolveConditioningMode(withHero)).toBe("hero_image");
    for (const p of buildHiggsfieldReelPromptPack(withHero)) {
      expect(p.prompt).not.toContain("previous shot ended on");
    }
  });

  it("M12: the workspace exposes creative intent vs the provider-safe scene", () => {
    const w = buildDraftWorkspace(SAMPLE_REEL_BRIEFS[0]);
    expect(w.execution.beats[0].intent).toBe(SAMPLE_REEL_BRIEFS[0].storyboardBeats[0].visual);
    expect(w.execution.beats[0].providerScene).not.toContain("MAX PRESS 44 PSI");
    expect(w.preflight.status).toBe("pass");
    expect(w.generation[0].prompt).toContain("Subject:");
  });

  it("M11: a rendered pixel defect routes to needs_paid_repair (publish held; not override-satisfiable)", () => {
    const findings: RenderedFinding[] = [
      { beatNumber: 2, code: "GENERATED_TEXT_ARTIFACT", severity: "block", description: "garbled letters on the case", preserve: [], change: ["remove text"] },
    ];
    const outcome = orchestratePostQa(findings);
    expect(outcome.publishGate).toBe("needs_paid_repair");
    expect(outcome.repairPlan.paidRegenerations).toBe(1);
  });

  it("SINGLE-BRIEF chain: ONE coherent battery brief flows through preflight (M10), conditioning (M8), and the workspace (M12)", () => {
    // Cloned from the known preflight-clean sample, then re-subjected to the SAME
    // battery mechanic truth the M3 thesis locks — so one subject runs the whole
    // render-facing chain (audit: the per-stage checks used mixed fixtures).
    const b = structuredClone(SAMPLE_REEL_BRIEFS[0]);
    b.topic = "The battery that quietly died over a hot Cleveland summer";
    b.mechanicTruth = GENOME.mechanicTruth;
    b.driverConfusion = GENOME.driverTension;
    b.clevelandAngle = GENOME.clevelandAngle;
    b.campaignKeyword = "BATTERY";
    b.storyboardBeats = [
      { beatNumber: 1, startSecond: 0, endSecond: 4, visual: "Extreme macro of a car battery terminal rimed with frost, cold blue light, breath-fog drifting past", motion: "slow push-in onto the terminal", onScreenText: "Your battery has been dying since July", purpose: "scroll-stop", audioCue: "low hum", safeZoneNotes: "terminal centered" },
      { beatNumber: 2, startSecond: 4, endSecond: 9, visual: "Cutaway of the battery cell, internal plates sluggish and dim in the cold", motion: "slow morph into the cell interior", onScreenText: "Summer heat quietly wore it down", purpose: "the mechanic truth", audioCue: "soft whoosh", safeZoneNotes: "cell in middle band" },
      { beatNumber: 3, startSecond: 9, endSecond: 14, visual: "The battery as a slowly draining hourglass, sand falling faster as frost spreads", motion: "hold, sand accelerating", onScreenText: "The first cold snap is what finally exposes it", purpose: "the metaphor", audioCue: "sand hiss", safeZoneNotes: "hourglass centered" },
      { beatNumber: 4, startSecond: 14, endSecond: 18, visual: "The frosted battery beside a warm-lit healthy one, the cold one dim, the healthy one steady", motion: "slow pan between the two", onScreenText: "A seasonal check catches it early", purpose: "why it matters", audioCue: "two soft ticks", safeZoneNotes: "both in middle band" },
      { beatNumber: 5, startSecond: 18, endSecond: 21, visual: "Pull back from the terminal to mirror the opening push-in as frost keeps spreading", motion: "pull-back loop seam", onScreenText: "DM BATTERY for a seasonal check", purpose: "CTA + loop", audioCue: "hum fades", safeZoneNotes: "CTA middle band" },
    ];
    b.captionHooks = ["Your battery has been dying since July.", "The cold didn't kill it — summer did."];
    b.selectedCaption = "Summer heat quietly wears a battery down; the first hard cold snap is what finally exposes it. Send this to someone whose car cranked slow this morning. DM BATTERY for a seasonal check.";

    // self-validating fixture: if the battery beats trip a gate this fails loudly
    expect(runReelPreflight(b).status).toBe("pass");
    const withHero = { ...b, visualWorld: { style: "safe" as const, heroFrameUrl: "https://x/h.jpg", framePrompt: "fp", lockedInvariants: "operator-approved reference frame locked" } };
    expect(resolveConditioningMode(withHero)).toBe("hero_image");
    const w = buildDraftWorkspace(b);
    expect(w.truth.mechanicTruth).toBe(GENOME.mechanicTruth); // same battery truth the M3 thesis locks
    expect(w.execution.beats[0].intent.toLowerCase()).toContain("battery");
    expect(w.generation[0].prompt).toContain("Subject:");
  });
});
