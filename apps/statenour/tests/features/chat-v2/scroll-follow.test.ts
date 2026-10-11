/**
 * tests/features/chat-v2/scroll-follow.test.ts - audit 09-F13, task R3-05.
 *
 * Auto-follow was re-decided from distance on every frame, so one frame that
 * grew more than 150px (a tool card, a code block) dropped follow for the rest
 * of the stream. Follow is now state: content growth keeps it, only the
 * operator's own scroll changes it, and Jump turns it back on.
 */
import { describe, it, expect } from "vitest";
import { nextFollow, NEAR_BOTTOM_PX } from "@/features/chat-v2/lib/scroll-position";

describe("nextFollow", () => {
  it("a big frame of new content keeps following", () => {
    expect(nextFollow(true, { kind: "content-grew", distanceFromBottom: 400 })).toBe(true);
  });

  it("content growth never starts following on its own", () => {
    expect(nextFollow(false, { kind: "content-grew", distanceFromBottom: 0 })).toBe(false);
  });

  it("the operator scrolling up stops following", () => {
    expect(nextFollow(true, { kind: "user-scroll", distanceFromBottom: 400 })).toBe(false);
  });

  it("CONTROL: the operator scrolling within the bottom band keeps following", () => {
    expect(nextFollow(true, { kind: "user-scroll", distanceFromBottom: 20 })).toBe(true);
    expect(nextFollow(false, { kind: "user-scroll", distanceFromBottom: NEAR_BOTTOM_PX - 1 })).toBe(true);
  });

  it("Jump to latest always follows again", () => {
    expect(nextFollow(false, { kind: "jump", distanceFromBottom: 5000 })).toBe(true);
  });
});
