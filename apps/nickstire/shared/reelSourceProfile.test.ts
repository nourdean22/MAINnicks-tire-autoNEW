/**
 * Source-aware production profile (2026-10-09): presence, caption style, shot
 * lineage, and the shot router's local routes. Positive controls first: each
 * block pins the LEGACY behaviour the change must not move, then the new one.
 */
import { describe, expect, it } from "vitest";
import {
  beatAllowsHands,
  describeShotLineage,
  parseCaptionStyle,
  parsePresenceProfile,
  parseShotLineage,
} from "./reelSourceProfile";
import {
  beatGenerationRoute,
  beatsTheGeneratorMustNotRender,
  beatsToResolveLocally,
  generationHoldReason,
} from "./shotRouter";

describe("presence profile", () => {
  it("defaults to object_only for anything unknown (every pre-2026-10-09 payload)", () => {
    expect(parsePresenceProfile(undefined)).toBe("object_only");
    expect(parsePresenceProfile("hands")).toBe("object_only");
    expect(parsePresenceProfile(42)).toBe("object_only");
    expect(parsePresenceProfile("hands_only_real")).toBe("hands_only_real");
  });
  it("allows hands ONLY under hands_only_real AND only on a beat declared real", () => {
    expect(beatAllowsHands("object_only", "real")).toBe(false);
    expect(beatAllowsHands("hands_only_real", "real")).toBe(true);
    expect(beatAllowsHands("hands_only_real", "ai_illustrative")).toBe(false);
    expect(beatAllowsHands("hands_only_real", "still_motion")).toBe(false);
    expect(beatAllowsHands("hands_only_real", "unspecified")).toBe(false);
    expect(beatAllowsHands("hands_only_real", null)).toBe(false);
  });
});

describe("caption style", () => {
  it("defaults to legacy_upper", () => {
    expect(parseCaptionStyle(undefined)).toBe("legacy_upper");
    expect(parseCaptionStyle("Sentence")).toBe("legacy_upper");
    expect(parseCaptionStyle("sentence")).toBe("sentence");
  });
});

describe("shot lineage", () => {
  it("parses only rows with a beat number and a known origin; never throws", () => {
    expect(parseShotLineage(undefined)).toEqual([]);
    expect(parseShotLineage("nope")).toEqual([]);
    const rows = parseShotLineage([
      { beatNumber: 2, origin: "registry_real_shop", source: "real", assetId: "ma_1", sha256: "ab".repeat(32) },
      { beatNumber: 0, origin: "local_card" },
      { beatNumber: 3, origin: "stock_library" },
      null,
    ]);
    expect(rows.map((r) => r.beatNumber)).toEqual([2]);
  });
  it("describes each shot by what the viewer is looking at", () => {
    const lines = describeShotLineage([
      { beatNumber: 3, origin: "local_card", source: "deterministic", renderer: "svg_card_v1", onScreenSec: 4 },
      { beatNumber: 1, origin: "registry_real_shop", source: "real", assetId: "ma_abc", sha256: "0123456789abcdef".repeat(4), onScreenSec: 6.5 },
      { beatNumber: 2, origin: "provider", source: "ai_illustrative", provider: "higgsfield" },
    ]);
    expect(lines[0]).toBe("beat 1: real shop footage (asset ma_abc, sha256 0123456789ab) 6.5s");
    expect(lines[1]).toBe("beat 2: generated (higgsfield)");
    expect(lines[2]).toBe("beat 3: deterministic card (svg_card_v1) 4.0s");
  });
});

describe("shot router local routes", () => {
  const real = { beatNumber: 1, visual: "REAL macro: a nail head in the tread" };
  const realBound = { ...real, realAssetId: "ma_nail" };
  const card = { beatNumber: 2, visual: "DETERMINISTIC card: tire cross-section, labels PLUG and INSIDE PATCH" };
  const gen = { beatNumber: 3, visual: "slow push-in on a worn tire under raking light" };
  const blank = { beatNumber: 4, visual: "Extreme macro of the physical subject" };

  it("a real beat with no registry asset is still a hold; with one it is bound locally", () => {
    expect(beatGenerationRoute(real)).toBe("needs_real_footage");
    expect(beatGenerationRoute(realBound)).toBe("bound_real");
    expect(beatGenerationRoute({ ...real, realAssetId: "   " })).toBe("needs_real_footage");
  });
  it("a deterministic beat is drawn locally, never held, never generated", () => {
    expect(beatGenerationRoute(card)).toBe("render_card");
  });
  it("undeclared beats with a subject still generate; subject-free ones are still held", () => {
    expect(beatGenerationRoute(gen)).toBe("generate");
    expect(beatGenerationRoute(blank)).toBe("needs_subject");
  });
  it("the hold list carries only holds; the local list carries only local routes, with their clip slots", () => {
    const beats = [realBound, card, gen, blank, real];
    expect(beatsTheGeneratorMustNotRender(beats, [])).toEqual([
      { beatNumber: 4, route: "needs_subject" },
      { beatNumber: 1, route: "needs_real_footage" },
    ]);
    expect(beatsToResolveLocally(beats, [])).toEqual([
      { beatNumber: 1, index: 0, route: "bound_real", realAssetId: "ma_nail" },
      { beatNumber: 2, index: 1, route: "render_card" },
    ]);
  });
  it("a resumed job keeps its clips: an http clip in the slot skips both lists", () => {
    const beats = [realBound, card, real];
    const clips = ["https://cdn/x.mp4", "https://cdn/y.mp4", "https://cdn/z.mp4"];
    expect(beatsTheGeneratorMustNotRender(beats, clips)).toEqual([]);
    expect(beatsToResolveLocally(beats, clips)).toEqual([]);
  });
  it("the hold reason names what each held beat needs", () => {
    const reason = generationHoldReason([{ beatNumber: 1, route: "needs_real_footage" }, { beatNumber: 2, route: "needs_deterministic_render" }], "enqueue");
    expect(reason).toMatch(/^BEAT_SOURCE_NOT_GENERATABLE \(blocked at enqueue, nothing reserved\)/);
    expect(reason).toContain("beat 1 is declared real with no registry asset bound");
    expect(reason).toContain("beat 2 is declared deterministic: the local card could not be rendered");
  });
});
