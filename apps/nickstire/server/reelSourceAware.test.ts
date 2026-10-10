/**
 * Source-aware production slice (2026-10-09): the regression fixtures the
 * creative mission named, as tests. Each `legacy` case is a positive control —
 * it pins what the change must NOT move — and each `new` case fails on the
 * pre-change code (run against 8e945f42: the 4 s clamp, the uppercase caption,
 * the no-hands rule on real beats, the deterministic hold).
 */
import { describe, expect, it } from "vitest";
import {
  briefToSegments,
  buildFfmpegArgs,
  CARD_CLIP_MAX_SECONDS,
  MAX_CLIP_SECONDS,
  REAL_CLIP_MAX_SECONDS,
  sanitizeCaption,
  sanitizeCaptionStyled,
  segmentCapSeconds,
  segmentsTotalSeconds,
} from "./services/reelAssembly";
import { runSafetyChecks, validateFacelessSubject, type ReelBrief } from "../client/src/lib/facelessReelStudio";
import { lineageForBinding, realShotRefusalReason, verifyRealShopVideoRow, type RealShopRowLike } from "./services/realShotBinding";
import { buildCardSvg, cardSpecFromBeat, lineageForCard } from "./services/deterministicCard";
import { locallyResolvedClipCount, mergeShotLineage } from "./services/localBeatResolution";
import { applyPresenceExemptions, cardBeats, describesDeclaredText, describesOnlyPermittedLimbs, handsExpectedBeats, isCaptionTimingMismatch, normalizedTextSurfaces, renderedQaVoteCount, reportsGarbledText, voteVerdicts, type RenderedFinding, type RenderedQaVerdict } from "./services/renderedQa";
import { beatRepairRefusal } from "./services/selectiveRepair";
import { expectedClipProof, expectedClipSha256 } from "./services/reelAssembly";
import { allShotsNonGenerative, shouldDiscloseAi } from "../shared/reelDisclosure";

const beat = (n: number, visual: string, extra: Record<string, unknown> = {}) => ({
  beatNumber: n, startSecond: (n - 1) * 4, endSecond: n * 4, onScreenText: `Beat ${n}`, visual, ...extra,
});

describe("segment duration follows the bound source, not a global clamp", () => {
  it("legacy: an undeclared beat is clamped to MAX_CLIP_SECONDS (4) however long it declares", () => {
    const segs = briefToSegments({ storyboardBeats: [{ beatNumber: 1, startSecond: 0, endSecond: 9, onScreenText: "x", visual: "a tire" }] });
    expect(segs[0].dur).toBe(MAX_CLIP_SECONDS);
    expect(segs[0]).not.toHaveProperty("captionStyle");
  });
  it("legacy: a real beat with NO probed duration keeps the 4 s cap (nothing is assumed about footage)", () => {
    expect(segmentCapSeconds({ visual: "REAL macro: a nail", source: "real" })).toBe(MAX_CLIP_SECONDS);
    expect(segmentCapSeconds({ visual: "REAL macro: a nail", sourceDurationSec: 0 })).toBe(MAX_CLIP_SECONDS);
  });
  it("new: a real beat bound to a 7 s clip keeps a 7 s beat; a 12 s declaration on a 7 s clip is trimmed to the clip, never padded", () => {
    const segs = briefToSegments({ storyboardBeats: [
      { beatNumber: 1, startSecond: 0, endSecond: 7, onScreenText: "x", visual: "REAL macro: a nail", source: "real", sourceDurationSec: 7 },
      { beatNumber: 2, startSecond: 7, endSecond: 19, onScreenText: "y", visual: "REAL: inner liner", source: "real", sourceDurationSec: 7 },
    ] });
    expect(segs.map((s) => s.dur)).toEqual([7, 7]);
  });
  it("new: a real clip longer than the per-beat ceiling is capped at REAL_CLIP_MAX_SECONDS (12)", () => {
    expect(segmentCapSeconds({ visual: "REAL: balancer spin", source: "real", sourceDurationSec: 40 })).toBe(REAL_CLIP_MAX_SECONDS);
  });
  it("new: a deterministic card may hold up to CARD_CLIP_MAX_SECONDS; a generated beat never grows", () => {
    expect(segmentCapSeconds({ visual: "DETERMINISTIC card: four causes", source: "deterministic" })).toBe(CARD_CLIP_MAX_SECONDS);
    expect(segmentCapSeconds({ visual: "slow push-in on a tire", source: "ai_illustrative", sourceDurationSec: 30 })).toBe(MAX_CLIP_SECONDS);
  });
  it("the render-integrity contract follows the same segments (a 7 s real beat makes the expected duration 7 s longer)", () => {
    const segs = briefToSegments({ storyboardBeats: [
      { beatNumber: 1, startSecond: 0, endSecond: 7, onScreenText: "x", visual: "REAL macro: a nail", source: "real", sourceDurationSec: 7 },
      { beatNumber: 2, startSecond: 7, endSecond: 11, onScreenText: "y", visual: "a tire" },
    ] });
    expect(segmentsTotalSeconds(segs)).toBe(11);
    const fc = buildFfmpegArgs({ segs, clipPaths: ["c1.mp4", "c2.mp4"], voPath: null, musicPath: null, assPath: null, fontPath: "/f.ttf", outPath: "o.mp4" }).join(" ");
    expect(fc).toContain("[0:v]trim=0:7,");
    expect(fc).toContain("[1:v]trim=0:4,");
  });
});

describe("caption style keeps meaning", () => {
  it("legacy: sanitizeCaption still uppercases and strips % and backslash, byte for byte", () => {
    expect(sanitizeCaption("Tread at 50% \\ 3/32 in")).toBe("TREAD AT 50 3/32 IN");
    expect(sanitizeCaptionStyled("Tread at 50% \\ 3/32 in", "legacy_upper")).toBe("TREAD AT 50 3/32 IN");
  });
  it("new: sentence style keeps case, %, / and units; drops only backslashes and control characters", () => {
    expect(sanitizeCaptionStyled("Tread at 50% \\ 3/32 in\nstill 11.8 V\u0007", "sentence")).toBe("Tread at 50% 3/32 in still 11.8 V");
  });
  it("new: a sentence caption is drawn with expansion=none; the legacy filter string is unchanged", () => {
    const legacy = briefToSegments({ storyboardBeats: [beat(1, "a tire", { onScreenText: "Tread at 50%" })] });
    const sentence = briefToSegments({ captionStyle: "sentence", storyboardBeats: [beat(1, "a tire", { onScreenText: "Tread at 50%" })] });
    expect(legacy[0].caption).toBe("TREAD AT 50");
    expect(sentence[0].caption).toBe("Tread at 50%");
    expect(sentence[0].captionStyle).toBe("sentence");
    const opts = (segs: typeof legacy) => ({ segs, clipPaths: ["c.mp4"], voPath: null, musicPath: null, assPath: null, fontPath: "/f.ttf", outPath: "o.mp4" });
    const legacyFc = buildFfmpegArgs(opts(legacy)).join(" ");
    const sentenceFc = buildFfmpegArgs(opts(sentence)).join(" ");
    expect(legacyFc).toContain("textfile='caption_0_0.txt':fontsize=");
    expect(legacyFc).not.toContain("expansion=none");
    expect(sentenceFc).toContain("textfile='caption_0_0.txt':expansion=none:fontsize=");
  });
});

function briefWith(beats: ReelBrief["storyboardBeats"], extra: Partial<ReelBrief> = {}): ReelBrief {
  return {
    id: "b", createdAt: "t", updatedAt: "t", status: "draft", mode: "studio", topic: "nail in the tread", mechanicTruth: "", driverConfusion: "", clevelandAngle: "",
    sourceNotes: [], factBucket: "wallet_protectors", campaignKeyword: "TIRES", archetype: "object_confession", motionLens: "macro_push",
    objectCharacter: "plain_part", voiceoverScript: "", selectedCaption: "", captionHooks: [], hashtags: [], storyboardBeats: beats, ...extra,
  } as unknown as ReelBrief;
}
const sb = (n: number, visual: string, motion = "slow push-in", extra: Record<string, unknown> = {}) => ({
  beatNumber: n, startSecond: (n - 1) * 4, endSecond: n * 4, visual, motion, onScreenText: `Beat ${n}`, purpose: "p", audioCue: "a", safeZoneNotes: "s", ...extra,
});

describe("presence profile: hands on real beats, faces nowhere", () => {
  const hands = "REAL: a technician's gloved hands rocking a wheel at twelve and six on the lift";
  it("legacy: validateFacelessSubject still rejects gloves and hands by default", () => {
    expect(validateFacelessSubject([hands]).ok).toBe(false);
    expect(validateFacelessSubject([hands]).reason).toContain("no faces, hands, gloves, or arms");
  });
  it("legacy: a brief without a profile blocks the gloved-hands beat with the storyboard-wide finding", () => {
    const report = runSafetyChecks(briefWith([sb(1, hands)] as never), () => "t");
    const f = report.findings.find((x) => x.rule === "no-human-face");
    expect(f?.where).toBe("storyboard");
    expect(report.blocked).toBe(true);
  });
  it("new: under hands_only_real a REAL beat with gloved hands passes; the same beat generated does not", () => {
    const real = runSafetyChecks(briefWith([sb(1, hands)] as never, { presenceProfile: "hands_only_real" }), () => "t");
    expect(real.findings.filter((x) => x.rule === "no-human-face")).toEqual([]);
    const generated = runSafetyChecks(briefWith([sb(1, "a technician's gloved hands rocking a wheel", "push-in", { source: "ai_illustrative" })] as never, { presenceProfile: "hands_only_real" }), () => "t");
    const f = generated.findings.find((x) => x.rule === "no-human-face");
    expect(f?.where).toBe("beat 1");
    expect(f?.fix).toContain("declare it REAL and bind captured footage");
  });
  it("new: a face is blocked on a real beat even under hands_only_real", () => {
    const report = runSafetyChecks(briefWith([sb(1, "REAL: the mechanic smiling at the camera beside the balancer")] as never, { presenceProfile: "hands_only_real" }), () => "t");
    const f = report.findings.find((x) => x.rule === "no-human-face");
    expect(f?.where).toBe("beat 1");
    expect(f?.match).toContain("a face or a figure is not");
  });
  it.each([
    "REAL: a technician's face beside their gloved hands",
    "REAL: the mechanic's face while tightening the wheel",
    "REAL: a gloved hand, the worker's head in the background",
    "REAL: half body of the tech leaning on the lift",
    "REAL: a silhouette walks past the bay door",
  ])("new: role-possessive faces and figures are blocked on real beats: %s", (visual) => {
    expect(validateFacelessSubject([visual], { allowHands: true }).ok).toBe(false);
  });
  it("new: hands on a tool with no face wording pass the hands-only check", () => {
    expect(validateFacelessSubject(["REAL: gloved hands seat the plug-patch on the inner liner"], { allowHands: true }).ok).toBe(true);
    // "sidewall face" is a tire surface, not a person.
    expect(validateFacelessSubject(["REAL macro: the sidewall face under raking light, a gloved hand steadies the tire"], { allowHands: true }).ok).toBe(true);
  });
});

describe("real-shot binding verifies the registry row, never the URL", () => {
  const row: RealShopRowLike = {
    id: "ma_nail", rightsStatus: "real_shop", reuseAllowed: 1, lifecycleState: "available", format: "video", mimeType: "video/mp4",
    runtimeUrl: "https://cdn.example/nail.mp4", checksumSha256: "ab".repeat(32), durationMs: 7000, isCurrent: 1,
  };
  it("binds a current, reusable real_shop video with a checksum and a duration", () => {
    const v = verifyRealShopVideoRow(1, "ma_nail", row);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.binding).toEqual({ beatNumber: 1, assetId: "ma_nail", url: row.runtimeUrl, sha256: row.checksumSha256, rightsStatus: "real_shop", sourceDurationSec: 7 });
      const l = lineageForBinding(v.binding, 4, () => "t");
      expect(l).toMatchObject({ beatNumber: 1, origin: "registry_real_shop", source: "real", assetId: "ma_nail", sourceDurationSec: 7, trimOutSec: 4, onScreenSec: 4, boundAt: "t" });
    }
  });
  it.each<[string, Partial<RealShopRowLike> | null, string]>([
    ["missing row", null, "asset_not_found"],
    ["ai-generated rights", { rightsStatus: "ai_generated" }, "not_real_shop"],
    ["stock rights", { rightsStatus: "licensed_stock" }, "not_real_shop"],
    ["reuse off", { reuseAllowed: 0 }, "reuse_not_allowed"],
    ["superseded version", { isCurrent: 0 }, "not_current_version"],
    ["rejected lifecycle", { lifecycleState: "rejected" }, "lifecycle_not_bindable"],
    ["a still, not footage", { format: "image", mimeType: "image/jpeg" }, "not_a_video"],
    ["no runtime url", { runtimeUrl: null }, "no_runtime_url"],
    ["bad checksum", { checksumSha256: "nope" }, "no_checksum"],
    ["no duration", { durationMs: null }, "no_duration"],
  ])("refuses %s", (_name, patch, refusal) => {
    const v = verifyRealShopVideoRow(2, "ma_x", patch === null ? null : { ...row, ...patch });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.refusal).toBe(refusal);
  });
  it("the refusal line names the beat, the asset and the reason, and says nothing was generated", () => {
    const v = verifyRealShopVideoRow(2, "ma_x", { ...row, rightsStatus: "ai_generated" });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const line = realShotRefusalReason([v]);
      expect(line).toMatch(/^REAL_ASSET_NOT_BINDABLE \(blocked at generation, before spend\): beat 2 \(asset ma_x\): not_real_shop/);
      expect(line).toContain("Nothing was generated.");
    }
  });
});

describe("deterministic card", () => {
  it("draws explicit cardLines, else the capitalised labels the proof packs write, else nothing", () => {
    expect(cardSpecFromBeat({ cardLines: ["Plug", "Inside patch"] }).lines).toEqual(["Plug", "Inside patch"]);
    expect(cardSpecFromBeat({ visual: "DETERMINISTIC card: tire cross-section, the hole through the tread, a plug stem drawn through it and a patch sealing it from the inside; labels PLUG and INSIDE PATCH" }).lines).toEqual(["PLUG", "INSIDE PATCH"]);
    expect(cardSpecFromBeat({ visual: "DETERMINISTIC card: four causes" }).lines).toEqual([]);
    expect(cardSpecFromBeat({}).badge).toBe("Illustration");
  });
  it("the SVG carries every line, the Illustration badge, and escapes markup", () => {
    const svg = buildCardSvg({ lines: ["PLUG", "<b>INSIDE PATCH</b>"], badge: "Illustration" });
    expect(svg).toContain(">PLUG<");
    expect(svg).toContain("&lt;b&gt;INSIDE PATCH&lt;/b&gt;");
    expect(svg).toContain(">Illustration<");
    expect(svg).toContain('width="1080" height="1920"');
  });
  it("its lineage is a drawn, non-frozen card with the rendered bytes' hash", () => {
    expect(lineageForCard(3, "cd".repeat(32), 4, () => "t")).toMatchObject({ beatNumber: 3, origin: "local_card", source: "deterministic", renderer: "svg_card_v1", stillHold: false, onScreenSec: 4, sha256: "cd".repeat(32) });
  });
});

describe("rendered QA under the presence profile", () => {
  const beats = [
    { beatNumber: 1, visual: "REAL: gloved hands rocking the wheel" },
    { beatNumber: 2, visual: "slow push-in on a tire" },
    { beatNumber: 3, visual: "REAL macro: the nail", source: "real" as const },
  ];
  const finding = (beatNumber: number | null, description: string): RenderedFinding => ({ beatNumber, code: "HUMAN_PRESENT", severity: "block", description, preserve: [], change: [] });
  it("legacy: no profile means no beat expects hands, and nothing is exempted", () => {
    expect(handsExpectedBeats({ storyboardBeats: beats })).toEqual([]);
    const f = [finding(1, "a gloved hand enters frame")];
    expect(applyPresenceExemptions(f, [])).toEqual({ kept: f, exempted: [] });
  });
  it("new: under hands_only_real only the REAL beats expect hands", () => {
    expect(handsExpectedBeats({ presenceProfile: "hands_only_real", storyboardBeats: beats })).toEqual([1, 3]);
  });
  it("new: a hands-only finding on a real beat is exempted; a face anywhere, or hands on a generated beat, still block", () => {
    const { kept, exempted } = applyPresenceExemptions([
      finding(1, "a gloved hand holds the wheel"),
      finding(1, "a technician's face is visible beside the wheel"),
      finding(2, "a hand reaches into frame"),
      finding(null, "a figure in the background"),
      finding(3, "fingers point at the nail"),
    ], [1, 3]);
    expect(exempted.map((f) => f.description)).toEqual(["a gloved hand holds the wheel", "fingers point at the nail"]);
    expect(kept.map((f) => [f.beatNumber, f.description.split(" ")[0]])).toEqual([[1, "a"], [2, "a"], [null, "a"]]);
    expect(kept.every((f) => f.severity === "block")).toBe(true);
  });
  it("new: the exemption recognises permitted limbs positively — a shoulder, a boot, a nameless presence all stay blocks", () => {
    expect(describesOnlyPermittedLimbs("a mechanic's gloved hand and shoulder are visible")).toBe(false);
    expect(describesOnlyPermittedLimbs("a gloved hand and a boot at the frame edge")).toBe(false);
    expect(describesOnlyPermittedLimbs("something human-shaped in the reflection")).toBe(false);
    expect(describesOnlyPermittedLimbs("")).toBe(false);
    expect(describesOnlyPermittedLimbs("a gloved hand and forearm on the ratchet")).toBe(true);
    expect(describesOnlyPermittedLimbs("fingertips press the gauge into the groove")).toBe(true);
    const { kept, exempted } = applyPresenceExemptions([finding(1, "a mechanic's gloved hand and shoulder are visible")], [1]);
    expect(exempted).toEqual([]);
    expect(kept).toHaveLength(1);
  });
  it("new: lettering on a drawn-card beat is exempted from GENERATED_TEXT_ARTIFACT; the same code on a generated beat still blocks", () => {
    const text = (beatNumber: number, description: string): RenderedFinding => ({ beatNumber, code: "GENERATED_TEXT_ARTIFACT", severity: "block", description, preserve: [], change: [] });
    expect(cardBeats({ shotLineage: [{ beatNumber: 3, origin: "local_card" }, { beatNumber: 1, origin: "registry_real_shop" }] })).toEqual([3]);
    const { kept, exempted } = applyPresenceExemptions([text(3, "white words PLUG and INSIDE PATCH on black"), text(2, "garbled signage on the wall")], [], [3]);
    expect(exempted.map((f) => f.beatNumber)).toEqual([3]);
    expect(kept.map((f) => f.beatNumber)).toEqual([2]);
  });
});

describe("rendered QA on an external master (2026-10-09 pilot lessons)", () => {
  const text = (beatNumber: number | null, description: string): RenderedFinding => ({ beatNumber, code: "GENERATED_TEXT_ARTIFACT", severity: "block", description, preserve: [], change: [] });
  const mismatch = (beatNumber: number | null, description: string): RenderedFinding => ({ beatNumber, code: "BEAT_SEMANTIC_MISMATCH", severity: "block", description, preserve: [], change: [] });
  const surfaces = normalizedTextSurfaces(["AI illustration | Not a customer case", "NICK'S | PATCH OR REPLACE?", "A nail is a clue. Not the whole story.", "ok"]);
  it("legacy: with nothing declared and no external master, nothing is exempted", () => {
    const f = [text(1, "the text 'AI illustration | Not a customer case' is baked into the frame"), mismatch(2, "the caption 'Nail in your tire?' is on the wrong beat")];
    expect(applyPresenceExemptions(f, [], [])).toEqual({ kept: f, exempted: [] });
    expect(normalizedTextSurfaces(["ok"])).toEqual([]); // too short to mean anything
  });
  it("new: a text-artifact finding that quotes a declared surface is exempted; one that quotes undeclared lettering stays a block", () => {
    expect(describesDeclaredText("The text 'AI illustration | Not a customer case' is baked into the 'first' frame.", surfaces)).toBe(true);
    expect(describesDeclaredText("A watermark-like string 'Vbort 2000' on the tester screen", surfaces)).toBe(false);
    // Separator- and apostrophe-proof (review of #2952): a transcription with an em
    // dash, no separator, or "Nick s" still matches the declared line.
    expect(describesDeclaredText("The badge reads \"AI illustration — Not a customer case\" at the bottom", surfaces)).toBe(true);
    expect(describesDeclaredText("text AI illustration Not a customer case burned in", surfaces)).toBe(true);
    expect(describesDeclaredText("a header bar reading Nick s / PATCH OR REPLACE", surfaces)).toBe(true);
    // A declared line reported as GARBLED stays a defect.
    expect(describesDeclaredText("The declared badge 'AI illustration | Not a customer case' is garbled and misspelled", surfaces)).toBe(false);
    expect(reportsGarbledText("the lettering is illegible")).toBe(true);
    expect(reportsGarbledText("the badge is present and crisp")).toBe(false);
    const { kept, exempted } = applyPresenceExemptions([
      text(null, "The text 'AI illustration | Not a customer case' is baked into the 'first' frame."),
      text(2, "Gibberish signage 'TRIE SHOPE' on the back wall"),
    ], [], [], { textSurfaces: ["AI illustration | Not a customer case"] });
    expect(exempted.map((f) => f.beatNumber)).toEqual([null]);
    expect(kept.map((f) => f.beatNumber)).toEqual([2]);
  });
  it("new: on an external master a caption-timing mismatch is exempted; a subject mismatch still blocks", () => {
    expect(isCaptionTimingMismatch("The hook card 'A nail is a clue.' is still present in the 'beat2' frame, but the planned beat states this card has ended.")).toBe(true);
    expect(isCaptionTimingMismatch("The planned caption 'before a repair decision.' is missing from beat 3.")).toBe(true);
    // Positive timing evidence is required (review of #2952): an action mismatch
    // phrased around a caption is not a timing note.
    expect(isCaptionTimingMismatch("The caption says the wheel is spinning, but the frame shows it stationary.")).toBe(false);
    expect(isCaptionTimingMismatch("The caption text does not match: the frame shows a spare tire instead of the belt.")).toBe(false);
    expect(isCaptionTimingMismatch("The caption and the frame disagree about the damage shown.")).toBe(false);
    expect(isCaptionTimingMismatch("The beat says pressure gauge and the frame shows an unrelated wheel.")).toBe(false);
    expect(isCaptionTimingMismatch("Beat 3 shows a spare tire instead of the belt routing the caption text describes")).toBe(false);
    const { kept, exempted } = applyPresenceExemptions([
      mismatch(2, "The hook card 'A nail is a clue.' is still present in the 'beat2' frame, but the planned beat states this card has ended."),
      mismatch(3, "The beat says pressure gauge and the frame shows an unrelated wheel."),
    ], [], [], { isExternalMaster: true });
    expect(exempted.map((f) => f.beatNumber)).toEqual([2]);
    expect(kept.map((f) => f.beatNumber)).toEqual([3]);
    // Not an external master: the same caption mismatch stays a block.
    expect(applyPresenceExemptions([mismatch(2, "The hook card is still present in the 'beat2' frame.")], [], []).kept).toHaveLength(1);
  });
  it("new: votes keep a block only when a majority of runs agree; warns are the union; the tally is recorded", () => {
    const v = (findings: RenderedFinding[], decision: "approve" | "repair" = findings.some((f) => f.severity === "block") ? "repair" : "approve"): RenderedQaVerdict => ({
      decision, findings, framesEvaluated: 5, evaluatedAt: "t", critic: "vision", qaState: "completed", droppedUnknownCodes: 0, visionCalls: 1,
    });
    const warn = (beatNumber: number, code: "PLASTIC_AI_LOOK" | "LIGHTING_DRIFT"): RenderedFinding => ({ beatNumber, code, severity: "warn", description: "d", preserve: [], change: [] });
    const runs = [
      v([mismatch(2, "hook card"), text(1, "badge"), warn(1, "PLASTIC_AI_LOOK")]),
      v([mismatch(2, "hook card"), warn(2, "LIGHTING_DRIFT")]),
      v([text(3, "badge on the end card"), warn(1, "PLASTIC_AI_LOOK")]),
    ];
    // mismatch:2 has 2 of 3 votes (kept); text:1 and text:3 have 1 each (dropped).
    const voted = voteVerdicts(runs, null);
    expect(voted.voting).toEqual({ runs: 3, agreedBlocks: 1, droppedBlocks: 2 });
    expect(voted.findings.filter((f) => f.severity === "block").map((f) => `${f.code}:${f.beatNumber}`)).toEqual(["BEAT_SEMANTIC_MISMATCH:2"]);
    expect(voted.findings.filter((f) => f.severity === "warn")).toHaveLength(2);
    expect(voted.decision).toBe("repair");
    expect(voted.visionCalls).toBe(3);
    // No agreed block and only craft warns → approve, and the craft-only repair is recorded as declined.
    const soft = voteVerdicts([v([text(1, "a")]), v([warn(1, "PLASTIC_AI_LOOK")], "repair"), v([warn(2, "PLASTIC_AI_LOOK")], "repair")], null);
    expect(soft.decision).toBe("approve");
    expect(soft.craftOnlyRepairDeclined).toBe(true);
    // Review of #2952: a majority of "repair" over blocks that did NOT agree, plus a
    // non-craft warn, is still approve — the decision rests on agreed blocks alone.
    const disagree = voteVerdicts([v([text(1, "a")]), v([mismatch(2, "b")]), v([warn(1, "LIGHTING_DRIFT")])], null);
    expect(disagree.decision).toBe("approve");
    expect(disagree.voting).toEqual({ runs: 3, agreedBlocks: 0, droppedBlocks: 2 });
    // A null-beat finding keys on the frame it names: one on the opening frame and
    // one on the end card are two different defects, not a 2-of-3 agreement.
    const nulls = voteVerdicts([
      v([text(null, "lettering baked into the first frame")]),
      v([text(null, "lettering baked into the final end card")]),
      v([]),
    ], null);
    expect(nulls.decision).toBe("approve");
    expect(nulls.voting).toEqual({ runs: 3, agreedBlocks: 0, droppedBlocks: 2 });
    const sameFrame = voteVerdicts([v([text(null, "the first frame shows a watermark")]), v([text(null, "watermark on the opening frame")]), v([])], null);
    expect(sameFrame.voting?.agreedBlocks).toBe(1);
    // One run is the identity.
    expect(voteVerdicts([runs[0]], null)).toBe(runs[0]);
  });
  it("new: the vote count comes from RENDERED_QA_VOTES, clamped to 1..5, default 1", () => {
    expect(renderedQaVoteCount({})).toBe(1);
    expect(renderedQaVoteCount({ RENDERED_QA_VOTES: "3" })).toBe(3);
    expect(renderedQaVoteCount({ RENDERED_QA_VOTES: "9" })).toBe(5);
    expect(renderedQaVoteCount({ RENDERED_QA_VOTES: "x" })).toBe(1);
  });
});

describe("an external master is never regenerated beat by beat", () => {
  it("refuses a paid repair on any beat of an external master; a pipeline job with a generatable beat is unchanged", () => {
    const beats = [{ beatNumber: 1, visual: "AI ILLUSTRATIVE: a tire" }];
    const pack = [{ beatNumber: 1, prompt: "p" }];
    expect(beatRepairRefusal({ storyboardBeats: beats, promptPack: pack, externalMaster: { textSurfaces: [] } }, 1, 7)).toMatch(/external master/);
    expect(beatRepairRefusal({ storyboardBeats: beats, promptPack: pack }, 1, 7)).toBeNull();
  });
});

describe("assembly verifies the exact bytes a bound beat was given", () => {
  it("reads the sha256 only for registry or card lineage rows with a valid hash", () => {
    const brief = { shotLineage: [
      { beatNumber: 1, origin: "registry_real_shop", sha256: "AB".repeat(32) },
      { beatNumber: 2, origin: "provider", sha256: "cd".repeat(32) },
      { beatNumber: 3, origin: "local_card", sha256: "nope" },
    ] };
    expect(expectedClipSha256(brief, 1)).toBe("ab".repeat(32));
    expect(expectedClipSha256(brief, 2)).toBeNull();
    expect(expectedClipSha256(brief, 3)).toBeNull();
    expect(expectedClipSha256({}, 1)).toBeNull();
    expect(expectedClipSha256({ shotLineage: "x" }, 1)).toBeNull();
  });
  it("distinguishes no local lineage from a local row with an unusable proof (assembly refuses the latter)", () => {
    const brief = { shotLineage: [
      { beatNumber: 1, origin: "registry_real_shop", sha256: "AB".repeat(32), url: "https://x/1" },
      { beatNumber: 2, origin: "provider" },
      { beatNumber: 3, origin: "local_card", sha256: "nope", url: "https://x/3" },
      { beatNumber: 4, origin: "registry_real_shop", url: "https://x/4" },
    ] };
    expect(expectedClipProof(brief, 1)).toEqual({ kind: "sha", sha256: "ab".repeat(32) });
    expect(expectedClipProof(brief, 2)).toEqual({ kind: "none" });
    expect(expectedClipProof(brief, 3).kind).toBe("invalid");
    expect(expectedClipProof(brief, 4).kind).toBe("invalid");
    expect(expectedClipProof({}, 9)).toEqual({ kind: "none" });
    // The disclosure path refuses the same rows as non-generative proof.
    const clips = JSON.stringify(["https://x/1", "https://x/3"]);
    expect(allShotsNonGenerative(clips, [brief.shotLineage[0], { beatNumber: 2, origin: "local_card", sha256: "nope", url: "https://x/3" }])).toBe(false);
  });
});

describe("AI disclosure follows the lineage", () => {
  const urls = ["https://cdn.example/a.mp4", "https://cdn.example/b.mp4", "https://cdn.example/c.mp4"];
  const real = (n: number) => ({ beatNumber: n, origin: "registry_real_shop", source: "real", sha256: "ab".repeat(32), url: urls[n - 1] });
  const card = (n: number) => ({ beatNumber: n, origin: "local_card", source: "deterministic", sha256: "cd".repeat(32), url: urls[n - 1] });
  const clips = JSON.stringify(urls);
  it("legacy: with no lineage the env provider decides for unknown URLs", () => {
    expect(shouldDiscloseAi(clips, "higgsfield")).toBe(true);
    expect(shouldDiscloseAi(clips, "template_stock")).toBe(false);
  });
  it("new: every clip registry footage or a drawn card means no AI label, whatever the env provider pins", () => {
    expect(shouldDiscloseAi(clips, "higgsfield", { shotLineage: [real(1), card(2), real(3)] })).toBe(false);
    expect(allShotsNonGenerative(clips, [real(1), card(2), real(3)])).toBe(true);
  });
  it("new: a partial lineage, a provider shot, or a provider CDN URL keeps the label", () => {
    expect(shouldDiscloseAi(clips, "higgsfield", { shotLineage: [real(1), card(2)] })).toBe(true);
    expect(shouldDiscloseAi(clips, "higgsfield", { shotLineage: [real(1), card(2), { beatNumber: 3, origin: "provider", source: "ai_illustrative" }] })).toBe(true);
    // A provider path segment ("higgsfield-<id>") is what clipProvenance recognises as generative.
    const withProvider = JSON.stringify(["https://cdn.example/a.mp4", "https://cdn.example/b.mp4", "https://cdn.example/higgsfield-abc123/x.mp4"]);
    expect(shouldDiscloseAi(withProvider, "template_stock", { shotLineage: [real(1), card(2), real(3)] })).toBe(true);
    expect(allShotsNonGenerative("not json", [real(1)])).toBe(false);
    expect(allShotsNonGenerative(JSON.stringify([]), [])).toBe(false);
    // An edited lineage row that names a URL other than the clip in its slot proves nothing.
    expect(allShotsNonGenerative(clips, [real(1), card(2), { ...real(3), url: "https://cdn.example/other.mp4" }])).toBe(false);
    expect(allShotsNonGenerative(clips, [real(1), card(2), { ...real(3), url: undefined }])).toBe(false);
  });
});

describe("settlement counts bound clips as free", () => {
  const beats = [{ beatNumber: 1 }, { beatNumber: 2 }, { beatNumber: 3 }];
  const lineage = [
    { beatNumber: 1, origin: "registry_real_shop", source: "real" },
    { beatNumber: 2, origin: "provider", source: "ai_illustrative" },
    { beatNumber: 3, origin: "local_card", source: "deterministic" },
  ];
  it("legacy: no lineage means no free clips (the original expression unchanged)", () => {
    expect(locallyResolvedClipCount(undefined, ["https://a", "https://b", "https://c"], beats)).toBe(0);
  });
  it("new: registry and card rows whose slot holds an http clip count; a provider row or an empty slot does not", () => {
    expect(locallyResolvedClipCount(lineage, ["https://a", "https://b", "https://c"], beats)).toBe(2);
    expect(locallyResolvedClipCount(lineage, ["https://a", "https://b", ""], beats)).toBe(1);
    expect(locallyResolvedClipCount(lineage, [], beats)).toBe(0);
  });
});

describe("lineage merge", () => {
  it("keeps one row per beat, newest binding winning, sorted by beat", () => {
    const merged = mergeShotLineage(
      [{ beatNumber: 2, origin: "provider", source: "ai_illustrative" }, { beatNumber: 1, origin: "provider", source: "unspecified" }],
      [{ beatNumber: 1, origin: "registry_real_shop", source: "real", assetId: "ma_1" }],
    );
    expect(merged.map((r) => [r.beatNumber, r.origin])).toEqual([[1, "registry_real_shop"], [2, "provider"]]);
  });
});

// ── 2026-10-10 quality upgrade ────────────────────────────────────────────────

describe("hero still: a real_shop photo anchors every generated clip", async () => {
  const { verifyRealShopStillRow, realStillInvariants } = await import("./services/realShotBinding");
  const still = {
    id: "ma_still", rightsStatus: "real_shop", reuseAllowed: 1, lifecycleState: "available", format: "image",
    mimeType: "image/jpeg", runtimeUrl: "https://cdn.example/reels/real-shop/bay.jpg", checksumSha256: "c".repeat(64), isCurrent: 1,
  };

  it("accepts a current, reusable real_shop JPEG with an image URL", () => {
    const v = verifyRealShopStillRow("ma_still", still);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.url).toBe(still.runtimeUrl);
  });

  it("refuses footage, generated stills, stale versions and URLs the CLI gate would drop", () => {
    const refusal = (row: Partial<typeof still>) => { const v = verifyRealShopStillRow("ma_still", { ...still, ...row }); return v.ok ? "ok" : v.refusal; };
    expect(refusal({ format: "video", mimeType: "video/mp4" })).toBe("not_an_image");
    expect(refusal({ rightsStatus: "ai_generated" })).toBe("not_real_shop");
    expect(refusal({ isCurrent: 0 })).toBe("not_current_version");
    expect(refusal({ lifecycleState: "rejected" })).toBe("lifecycle_not_bindable");
    expect(refusal({ runtimeUrl: "https://cdn.example/bay" })).toBe("no_runtime_url");
    expect(refusal({ checksumSha256: "nope" })).toBe("no_checksum");
    expect(verifyRealShopStillRow("ma_x", null).ok).toBe(false);
  });

  it("the real-place invariants name the shop and forbid a studio or a different bay", () => {
    const text = realStillInvariants("ma_still");
    expect(text).toMatch(/real photograph of Nick's Tire/);
    expect(text).toMatch(/studio background/);
    expect(text).toContain("ma_still");
    expect(realStillInvariants("ma_still", "lift two, afternoon")).toContain("lift two, afternoon");
  });
});

describe("realism pass: the generator is asked for photographed material, not a render", async () => {
  const { REALISM_DIRECTIVE, MOTION_LENSES, buildHiggsfieldReelPromptPack } = await import("../client/src/lib/facelessReelStudio");
  it("every beat prompt carries the realism directive and the render vocabulary is gone from the lens grammars", () => {
    expect(REALISM_DIRECTIVE).toMatch(/Photographed, not rendered/);
    expect(REALISM_DIRECTIVE).toMatch(/contact shadow/);
    for (const lens of Object.values(MOTION_LENSES)) {
      expect(lens.grammar).not.toMatch(/8K|ultra-detailed|studio-grade/);
    }
  });
  it("the pack builder inserts it on every beat and bans the render look in the DO-NOT list", () => {
    const brief = {
      id: "t", topic: "tread", archetype: "satisfying_loop", objectCharacter: "plain_part", motionLens: "hyperreal_cinematic",
      storyboardBeats: [
        { beatNumber: 1, startSecond: 0, endSecond: 4, purpose: "p", visual: "a worn tire on a lift", motion: "slow push", onScreenText: "LOOK", narration: "", audioCue: "", safeZoneNotes: "" },
        { beatNumber: 2, startSecond: 4, endSecond: 8, purpose: "p", visual: "the tread groove up close", motion: "hold", onScreenText: "CLOSER", narration: "", audioCue: "", safeZoneNotes: "" },
      ],
    } as unknown as Parameters<typeof buildHiggsfieldReelPromptPack>[0];
    const pack = buildHiggsfieldReelPromptPack(brief);
    expect(pack).toHaveLength(2);
    for (const p of pack) {
      expect(p.prompt).toContain(REALISM_DIRECTIVE);
      expect(p.negativePrompt).toContain("3D render look");
      expect(p.negativePrompt).toContain("uniform plastic sheen");
    }
  });
});

describe("clip model follows REEL_CLIP_MODEL, and so does the reservation price", async () => {
  const { reelClipCostUsd, COST_ESTIMATES_USD } = await import("./services/generationLedger");
  it("the default prices as seedance1_5; seedance_2_5 and kling reserve at their own figure; junk falls back", () => {
    expect(reelClipCostUsd("higgsfield", {} as NodeJS.ProcessEnv)).toBe(COST_ESTIMATES_USD.seedance_clip);
    expect(reelClipCostUsd("higgsfield", { REEL_CLIP_MODEL: "seedance_2_5" } as NodeJS.ProcessEnv)).toBe(COST_ESTIMATES_USD.seedance_2_5_clip);
    expect(reelClipCostUsd("higgsfield", { REEL_CLIP_MODEL: "kling3_0_turbo" } as NodeJS.ProcessEnv)).toBe(COST_ESTIMATES_USD.kling3_0_clip);
    expect(reelClipCostUsd("higgsfield", { REEL_CLIP_MODEL: "sora2" } as NodeJS.ProcessEnv)).toBe(COST_ESTIMATES_USD.seedance_clip);
    expect(COST_ESTIMATES_USD.seedance_2_5_clip).toBeGreaterThan(COST_ESTIMATES_USD.seedance_clip * 2);
  });
});
