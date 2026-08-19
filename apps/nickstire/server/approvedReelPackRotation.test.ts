import { describe, expect, it } from "vitest";
import {
  APPROVED_REEL_PACKS,
  APPROVED_REEL_PACK_SLUGS,
  approvedReelPackAt,
  parseApprovedPackRotationIndex,
  resolveApprovedPackRotationIndex,
} from "./services/approvedReelPackRotation";

describe("approved Reel-pack rotation", () => {
  it("contains every explicitly approved pack exactly once", () => {
    expect(APPROVED_REEL_PACKS).toHaveLength(32);
    expect(new Set(APPROVED_REEL_PACK_SLUGS).size).toBe(32);
  });

  it("uses the reviewed chronological order and a generator-safe topic", () => {
    expect(approvedReelPackAt(0)).toEqual({
      slug: "2026-08-16-wheel-bearing-hum",
      topic: "wheel bearing hum",
    });
    expect(approvedReelPackAt(31)).toEqual({
      slug: "2026-08-19-wont-start-battery-starter-alternator",
      topic: "wont start battery starter alternator",
    });
  });

  it("does not wrap completed or invalid rotations back to the first pack", () => {
    expect(approvedReelPackAt(-1)).toBeNull();
    expect(approvedReelPackAt(32)).toBeNull();
    expect(approvedReelPackAt(Number.NaN)).toBeNull();
    expect(parseApprovedPackRotationIndex("0")).toBe(0);
    expect(parseApprovedPackRotationIndex("31")).toBe(31);
    expect(parseApprovedPackRotationIndex("32")).toBe(32);
    expect(parseApprovedPackRotationIndex(null)).toBeNull();
    expect(parseApprovedPackRotationIndex("nope")).toBeNull();
    expect(parseApprovedPackRotationIndex("-1")).toBeNull();
  });

  it("uses the first pack for an absent cursor in both selection and completion", () => {
    expect(resolveApprovedPackRotationIndex(null)).toBe(0);
    expect(resolveApprovedPackRotationIndex("0")).toBe(0);
    expect(resolveApprovedPackRotationIndex("nope")).toBeNull();
  });
});
