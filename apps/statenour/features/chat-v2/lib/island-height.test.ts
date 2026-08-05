/**
 * 2026-08-05 · The chat island must never overwrite the bottom-chrome
 * reservation with a raw visual-viewport height.
 *
 * THE LIVE DEFECT THIS PINS. Measured on bdnick.info/chat with the operator's
 * session: shell border box 602.364px, padding-bottom 53px (the measured
 * --bottom-chrome-h), so the content box was 549.4px. A DOM probe confirmed
 * `height: 100%` resolved correctly to 549.4 — the CSS was right. But the
 * island carried style="height: 602.364px", written by chat-island's
 * visualViewport handler, and an inline height beats the `h-full` class. The
 * island rendered 53px too tall, its flex children filled that wrong height,
 * and the composer's bottom landed at 602.4 against a tab-bar top of 549.4 —
 * exactly 53px of overlap, which is what the operator saw.
 *
 * The handler exists for a real reason: iOS does not shrink the layout
 * viewport when the soft keyboard opens, so a fixed shell keeps its height and
 * the composer hides behind the keyboard. These tests pin BOTH halves — the
 * keyboard case still takes over, and the ordinary case hands the height back
 * to CSS instead of pinning a wrong pixel value.
 */
import { describe, expect, it } from "vitest";
import { resolveIslandHeight } from "./island-height";

/** The exact geometry measured live on bdnick.info/chat, 2026-08-05. */
const LIVE = {
  parentHeight: 602.364,
  parentPaddingTop: 0,
  parentPaddingBottom: 53,
};
const LIVE_CONTENT_BOX = 549.364;

describe("resolveIslandHeight", () => {
  it("defers to CSS in the exact live geometry that was overlapping", () => {
    // The regression: viewportHeight === parentHeight, and the old code
    // assigned it outright, landing 53px past the content box.
    const result = resolveIslandHeight({ ...LIVE, viewportHeight: 602.364 });
    expect(result).toBeNull();
  });

  it("defers to CSS in the DEFAULT-reservation geometry, screenshotted overlapping", () => {
    // The state actually captured on the live page: BottomTabBar's
    // ResizeObserver had NOT published, so --bottom-chrome-h was still the
    // 96px CSS default while the real chrome measured 52.94px. The old code
    // pinned the island to 602.364 (96px past the 506.36 content box), so the
    // composer bottom landed at 602.36 against a bar top of 549.4 — the ~53px
    // of clipped composer visible in the screenshot.
    const result = resolveIslandHeight({
      parentHeight: 602.364,
      parentPaddingTop: 0,
      parentPaddingBottom: 96,
      viewportHeight: 602.364,
    });
    expect(result).toBeNull();
  });

  it("never returns the raw viewport height for ANY viewport at or above the content box", () => {
    // Was a single case with the same inputs as the test above, so it could
    // not fail independently — documentation wearing an assertion. Swept
    // across the range instead, which does discriminate: the old
    // `return viewportHeight` passes the keyboard tests but fails every
    // point here.
    for (const viewportHeight of [549.364, 560, 602.364, 700, 1200, 5000]) {
      const result = resolveIslandHeight({ ...LIVE, viewportHeight });
      expect(result, `viewportHeight=${viewportHeight}`).toBeNull();
    }
  });

  it("defers to CSS when the operator is pinch-zoomed, not just when tall", () => {
    // Zoom halves visualViewport.height exactly like the keyboard does, but
    // parentHeight comes from a `fixed` element's rect and does NOT move with
    // zoom — so without the scale guard this shrinks the island out from under
    // the area being read. app/layout.tsx omits maximumScale on purpose
    // (WCAG 1.4.4), so this input is reachable on the operator's phone.
    const zoomed = {
      parentHeight: 844,
      parentPaddingTop: 59,
      parentPaddingBottom: 53,
      viewportHeight: 422, // 2x zoom on an 844 layout viewport
    };
    expect(resolveIslandHeight({ ...zoomed, viewportScale: 2 })).toBeNull();
    // Same geometry, no zoom -> that IS a keyboard, so it must still pin.
    expect(resolveIslandHeight({ ...zoomed, viewportScale: 1 })).toBe(363);
  });

  it("treats a missing or degenerate scale as unzoomed", () => {
    // visualViewport.scale is absent in some engines; defaulting to zoomed
    // would silently disable the keyboard fix everywhere.
    const kb = { ...LIVE, viewportHeight: 300 };
    expect(resolveIslandHeight(kb)).toBe(300);
    expect(resolveIslandHeight({ ...kb, viewportScale: Number.NaN })).toBe(300);
    expect(resolveIslandHeight({ ...kb, viewportScale: 0.5 })).toBe(300);
  });

  it("takes over when the soft keyboard shrinks the visual viewport", () => {
    // iPhone keyboard is ~300px; visualViewport drops well below the content box.
    expect(resolveIslandHeight({ ...LIVE, viewportHeight: 300 })).toBe(300);
  });

  it("subtracts the safe-area padding-top from the keyboard-bound height", () => {
    // The island starts below the notch inset, so the space it can occupy is
    // the visual viewport minus that inset — not the whole viewport.
    expect(
      resolveIslandHeight({
        parentHeight: 800,
        parentPaddingTop: 59,
        parentPaddingBottom: 53,
        viewportHeight: 400,
      }),
    ).toBe(341);
  });

  it("hands back to CSS when the viewport exceeds the content box", () => {
    // Desktop: visual viewport is the whole window, larger than the reserved
    // content box. CSS must win so --bottom-chrome-h stays authoritative.
    expect(resolveIslandHeight({ ...LIVE, viewportHeight: 5000 })).toBeNull();
  });

  it("tolerates sub-pixel drift instead of flickering", () => {
    // Viewport and layout heights are fractional and measured by different
    // subsystems. A hair under the content box must NOT pin, or the island
    // would toggle between pinned and unpinned on every scroll event.
    const hair = LIVE_CONTENT_BOX - 0.4;
    expect(resolveIslandHeight({ ...LIVE, viewportHeight: hair })).toBeNull();
  });

  it("does engage once the shortfall exceeds the slack", () => {
    // Guards the guard above: the tolerance must not be so wide that a real
    // keyboard is ignored.
    const realShortfall = LIVE_CONTENT_BOX - 40;
    expect(resolveIslandHeight({ ...LIVE, viewportHeight: realShortfall })).toBe(
      realShortfall,
    );
  });

  it("tracks a reservation that grows after mount", () => {
    // The case that started all of this: BottomTabBar's ticker wraps to a
    // second line, the ResizeObserver publishes a taller --bottom-chrome-h,
    // and the shell's padding-bottom grows. The content box shrinks with it,
    // and CSS must still be the one to follow it.
    const grown = { ...LIVE, parentPaddingBottom: 106 };
    expect(resolveIslandHeight({ ...grown, viewportHeight: 602.364 })).toBeNull();
  });

  it("defers to CSS before the shell has been laid out", () => {
    // SSR / display:none / pre-hydration. Pinning 0 or a negative height here
    // would flash a collapsed island.
    expect(
      resolveIslandHeight({
        parentHeight: 0,
        parentPaddingTop: 0,
        parentPaddingBottom: 0,
        viewportHeight: 600,
      }),
    ).toBeNull();
  });

  it("defers to CSS when padding alone exceeds the parent box", () => {
    // Mid-layout transient: a stale reservation larger than the shell itself
    // would make the content box negative.
    expect(
      resolveIslandHeight({
        parentHeight: 40,
        parentPaddingTop: 0,
        parentPaddingBottom: 53,
        viewportHeight: 600,
      }),
    ).toBeNull();
  });

  it("never returns a negative height", () => {
    // A visual viewport smaller than the safe-area inset is nonsense, but it
    // must not produce a negative CSS height.
    const result = resolveIslandHeight({
      parentHeight: 800,
      parentPaddingTop: 59,
      parentPaddingBottom: 53,
      viewportHeight: 10,
    });
    expect(result).toBe(0);
  });

  it("defers to CSS on a non-finite viewport height", () => {
    expect(resolveIslandHeight({ ...LIVE, viewportHeight: Number.NaN })).toBeNull();
  });
});
