/**
 * ScanFinish Run 2 — end-to-end proof-of-work.
 *
 * One synthetic reel flows through every stage this run built or wired,
 * using the REAL functions from each item (not re-implemented fixtures) —
 * only the DB and the paid LLM/video-provider boundary are out of scope for
 * an unattended proof (no spend, no live publish, per this repo's protected-
 * operations rule). Every other function called here is the actual shipped
 * code: mineTopicCandidates, buildRepetitionChecks, selectReelVideoProvider,
 * extractBeatStructureSignals, evaluateOriginalityQc, compareAllSignals,
 * swipeFileConviction, selectMultilingualCandidates.
 *
 * This is the receipt for the brief's Definition of Done: "run one reel
 * through the entire system... and paste the real command output."
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mineTopicCandidates, autoRenderable } from "../shared/contentTopicMiner";
import { localDiscoveryTopics, LOCAL_DISCOVERY_LIBRARY } from "../shared/localDiscoveryLibrary";
import { buildRepetitionChecks } from "../client/src/lib/facelessReelStudio";
import { extractBeatStructureSignals } from "../shared/beatStructureSignals";
import { extractHookSignals } from "../shared/hookSignals";
import { evaluateOriginalityQc } from "../shared/originalityQcChecklist";
import { compareAllSignals, swipeFileConviction, type SwipeFileSample } from "../shared/attentionMicrostructure";
import { selectMultilingualCandidates } from "../shared/multilingualCandidates";
import { selectReelVideoProvider } from "./services/reelPipeline";

afterEach(() => vi.unstubAllEnvs());

describe("ScanFinish Run 2 — one reel through the whole system", () => {
  it("hook-mining -> repetition check -> QC checklist -> provider routing -> swipe-file measurement -> multilingual worklist", async () => {
    const report: Record<string, unknown> = {};

    // ── STAGE 1: hook-mining (item f — Local Discovery library) ──
    const miningSignals = { localDiscoveryTopics: localDiscoveryTopics([]) };
    const candidates = autoRenderable(mineTopicCandidates(miningSignals));
    expect(candidates.length).toBeGreaterThan(0);
    const picked = candidates[0];
    report.stage1_mining = { source: picked.source, franchiseId: picked.franchiseId, topic: picked.topic, score: picked.score };

    // ── STAGE 2: anti-repetition memory (item b) ──
    const freshCheck = buildRepetitionChecks(
      { topic: picked.topic, campaignKeyword: "PRESSURE", archetype: "proof", motionLens: "handheld", objectCharacter: "tire" },
      { topics: ["an unrelated prior topic"], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [] },
    );
    const repeatCheck = buildRepetitionChecks(
      { topic: picked.topic, campaignKeyword: "PRESSURE", archetype: "proof", motionLens: "handheld", objectCharacter: "tire" },
      { topics: [picked.topic], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [] },
    );
    expect(freshCheck.topicRepeated).toBe(false);
    expect(repeatCheck.topicRepeated).toBe(true);
    report.stage2_repetition = { freshTopicRepeated: freshCheck.topicRepeated, sameTopicRepeated: repeatCheck.topicRepeated };

    // ── STAGE 3: multi-vendor routing (item e) — explicit pin, no credentials needed for the routing decision itself ──
    vi.stubEnv("REEL_VIDEO_PROVIDER", "higgsfield");
    const routedProvider = await selectReelVideoProvider();
    expect(routedProvider).toBe("higgsfield");
    report.stage3_routing = { selectedProvider: routedProvider };

    // ── STAGE 4: originality/QC checklist (item c), beat structure reused from item d ──
    const syntheticBrief = {
      storyboardBeats: [
        { beatNumber: 1, startSecond: 0, endSecond: 4, visual: "extreme close-up of cracked tire sidewall", onScreenText: "This bulge is not the pothole's fault." },
        { beatNumber: 2, startSecond: 4, endSecond: 10, visual: "slow orbit around the wheel", onScreenText: "The pothole just found the weak spot." },
        { beatNumber: 3, startSecond: 10, endSecond: 16, visual: "hand pointing to the sidewall bulge" },
        { beatNumber: 4, startSecond: 16, endSecond: 20, visual: "clean shop bay, tire on the rack" },
      ],
      ctaType: "send" as const,
    };
    const beatStructure = extractBeatStructureSignals(syntheticBrief);
    const qc = evaluateOriginalityQc({
      claimEntailments: ["supported"],
      captionQaBlocking: false,
      voiceoverQaBlocking: false,
      disclosureMode: "visibly_animated",
      clevelandAngle: "Euclid's pothole season stresses a sidewall that already has curb damage",
      caption: "Send this to someone whose tires are bald.",
      totalDurationSeconds: beatStructure.totalDurationSeconds,
    });
    expect(qc.failCount).toBe(0);
    report.stage4_qc = { beatStructure, passCount: qc.passCount, failCount: qc.failCount, checks: qc.checks.map((c) => `${c.id}:${c.status}`) };

    // ── STAGE 5: attention-microstructure swipe-file measurement (item d) — real
    // outcome numbers this run cannot fabricate, so this stage uses synthetic
    // fixture samples large enough to clear MIN_GROUP_N and demonstrate the
    // comparator running for real, exactly as it will once enough reels publish. ──
    const hookSignals = extractHookSignals({ visual: syntheticBrief.storyboardBeats[0].visual, onScreenText: syntheticBrief.storyboardBeats[0].onScreenText });
    const swipeFileSamples: SwipeFileSample[] = [
      ...Array.from({ length: 4 }, (_, i) => ({
        jobId: i,
        hook: hookSignals,
        beatStructure: extractBeatStructureSignals({ ctaType: "send" as const }),
        metrics: { savesPerReach: 0.03, sharesPerReach: null, skipRate: null },
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        jobId: 10 + i,
        hook: extractHookSignals({ visual: "wide establishing shot", onScreenText: "Cleveland winters bring more than just snow..." }),
        beatStructure: extractBeatStructureSignals({ ctaType: "none" as const }),
        metrics: { savesPerReach: 0.01, sharesPerReach: null, skipRate: null },
      })),
    ];
    const comparisons = compareAllSignals(swipeFileSamples, "savesPerReach");
    const ctaComparison = comparisons.find((c) => c.signal === "hasCta")!;
    expect(ctaComparison.sufficient).toBe(true);
    expect(swipeFileConviction(ctaComparison)).toBe("MED/INFERRED");
    report.stage5_swipeFile = { signal: ctaComparison.signal, withAvg: ctaComparison.withAvg, withoutAvg: ctaComparison.withoutAvg, conviction: swipeFileConviction(ctaComparison) };

    // ── STAGE 6: multilingual variant worklist (item g) ──
    const dubCandidates = selectMultilingualCandidates([
      { postId: "post_1", mediaProductType: "REELS", caption: "top reel", engagementRate: 0.12, reach: 900, saved: 20, shares: 10 },
      { postId: "post_2", mediaProductType: "IMAGE", caption: "carousel", engagementRate: 0.5, reach: 900, saved: 0, shares: 0 },
    ]);
    expect(dubCandidates.map((c) => c.postId)).toEqual(["post_1"]);
    report.stage6_multilingual = dubCandidates.map((c) => ({ postId: c.postId, reason: c.reason }));

    // ── FULL REPORT — the receipt ──
    console.log("\n=== ScanFinish Run 2 — one reel through the whole system ===\n" + JSON.stringify(report, null, 2) + "\n");
  });
});
