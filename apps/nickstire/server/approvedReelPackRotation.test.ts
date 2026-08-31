import { describe, expect, it } from "vitest";
import {
  APPROVED_REEL_PACKS,
  APPROVED_REEL_PACK_SLUGS,
  approvedReelPackAt,
  buildBriefFromApprovedProductionPack,
  loadApprovedProductionPack,
  parseApprovedPackRotationIndex,
  resolveApprovedPackRotationIndex,
} from "./services/approvedReelPackRotation";

describe("approved Reel-pack rotation", () => {
  it("contains every explicitly approved pack exactly once", () => {
    expect(APPROVED_REEL_PACKS).toHaveLength(APPROVED_REEL_PACK_SLUGS.length);
    expect(new Set(APPROVED_REEL_PACK_SLUGS).size).toBe(APPROVED_REEL_PACK_SLUGS.length);
  });

  it("uses the reviewed chronological order and a generator-safe topic", () => {
    expect(approvedReelPackAt(0)).toEqual({
      slug: "2026-08-16-wheel-bearing-hum",
      topic: "wheel bearing hum",
    });
    const last = APPROVED_REEL_PACKS[APPROVED_REEL_PACKS.length - 1];
    expect(last).toBeDefined();
    expect(approvedReelPackAt(APPROVED_REEL_PACKS.length - 1)).toEqual(last);
  });

  it("does not wrap completed or invalid rotations back to the first pack", () => {
    expect(approvedReelPackAt(-1)).toBeNull();
    expect(approvedReelPackAt(APPROVED_REEL_PACKS.length)).toBeNull();
    expect(approvedReelPackAt(Number.NaN)).toBeNull();
    expect(parseApprovedPackRotationIndex("0")).toBe(0);
    expect(parseApprovedPackRotationIndex(String(APPROVED_REEL_PACKS.length - 1))).toBe(APPROVED_REEL_PACKS.length - 1);
    expect(parseApprovedPackRotationIndex(String(APPROVED_REEL_PACKS.length))).toBe(APPROVED_REEL_PACKS.length);
    expect(parseApprovedPackRotationIndex(null)).toBeNull();
    expect(parseApprovedPackRotationIndex("nope")).toBeNull();
    expect(parseApprovedPackRotationIndex("-1")).toBeNull();
  });

  it("uses the first pack for an absent cursor in both selection and completion", () => {
    expect(resolveApprovedPackRotationIndex(null)).toBe(0);
    expect(resolveApprovedPackRotationIndex("0")).toBe(0);
    expect(resolveApprovedPackRotationIndex("nope")).toBeNull();
  });

  it("preserves the reviewed pack snapshot instead of handing only its topic downstream", () => {
    const pack = approvedReelPackAt(0)!;
    const snapshot = loadApprovedProductionPack(pack.slug);
    expect(snapshot?.packId).toBe(pack.slug);
    expect(snapshot?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    const brief = snapshot && buildBriefFromApprovedProductionPack(pack, snapshot, "autopost-test");
    expect(brief?.approvedPackSlug).toBe(pack.slug);
    expect(brief?.selectedCaption).toEqual(expect.any(String));
    expect((brief?.storyboardBeats as unknown[]).length).toBeGreaterThanOrEqual(4);
    expect((brief?.sourceNotes as Array<{ kind?: string }>).some((note) => note.kind === "proof")).toBe(true);
  });

  it("gives every currently approved tracked pack a proof-shaped source note", () => {
    for (const pack of APPROVED_REEL_PACKS) {
      const snapshot = loadApprovedProductionPack(pack.slug);
      expect(snapshot, pack.slug).not.toBeNull();
      const brief = snapshot && buildBriefFromApprovedProductionPack(pack, snapshot, `autopost-${pack.slug}`);
      expect(brief, pack.slug).not.toBeNull();
      expect((brief?.sourceNotes as Array<{ kind?: string }>).some((note) => note.kind === "proof"), pack.slug).toBe(true);
    }
  });
});
