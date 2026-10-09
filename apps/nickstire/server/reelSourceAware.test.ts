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
import { applyPresenceExemptions, cardBeats, describesOnlyPermittedLimbs, handsExpectedBeats, type RenderedFinding } from "./services/renderedQa";
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
