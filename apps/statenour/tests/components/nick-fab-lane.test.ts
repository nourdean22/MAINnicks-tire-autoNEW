/**
 * tests/components/nick-fab-lane.test.ts · 2026-09-07
 *
 * The NICK floating button is `position: fixed` at the bottom-right, so page
 * content that scrolls under it collides — live-verified on /journal ("ANSWER
 * NOW") and /missions (the capture "+") at ~1090 CSS px. The fix reserves a
 * lane: while a NickSidePane is mounted, `--nick-fab-lane` is set on <html>
 * and (mastery)/layout.tsx's <main> pads its right edge by it on md+ screens.
 *
 * Both halves are pinned here — the pure reserve/release helper with a fake
 * root (no DOM needed), and the layout's consumption of the variable — so a
 * future edit that drops either half fails a test instead of reintroducing
 * the overlap silently.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NICK_FAB_LANE, NICK_FAB_LANE_VAR, reserveFabLane } from "@/components/mastery/nick-side-pane";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function fakeRoot() {
  const props = new Map<string, string>();
  return {
    props,
    style: {
      setProperty: (n: string, v: string) => void props.set(n, v),
      removeProperty: (n: string) => void props.delete(n),
    },
  };
}

describe("NICK FAB lane", () => {
  it("reserves the lane on mount and releases it on cleanup", () => {
    const root = fakeRoot();
    const release = reserveFabLane(root);
    expect(root.props.get(NICK_FAB_LANE_VAR)).toBe(NICK_FAB_LANE);
    release();
    expect(root.props.has(NICK_FAB_LANE_VAR)).toBe(false);
  });

  it("the lane is at least as wide as the FAB it clears (44px + gap)", () => {
    // 7rem = 112px at the 16px root. The pill (icon + "nick" label + px-3.5 +
    // border) measures ~78px and sits at right-4 (16px); 4.75rem let it intrude
    // on the content column at 768px (e2e run 34175702944, 2026-09-08).
    expect(parseFloat(NICK_FAB_LANE) * 16).toBeGreaterThanOrEqual(78 + 16 + 8);
  });

  it("the mastery layout consumes the variable on md+ screens", () => {
    const layout = readFileSync(resolve(APP_ROOT, "app/(mastery)/layout.tsx"), "utf8");
    expect(layout).toMatch(/md:pr-\[var\(--nick-fab-lane,0px\)\]/);
  });

  it("the pane reserves the lane while mounted (the effect is wired, not just exported)", () => {
    const pane = readFileSync(resolve(APP_ROOT, "components/mastery/nick-side-pane.tsx"), "utf8");
    // 2026-09-08 · the effect also announces the pane on <html> and listens for the
    // More-sheet open event (phones no longer render the floating pill).
    expect(pane).toMatch(/const release = reserveFabLane\(root\)/);
    expect(pane).toMatch(/root\.dataset\[NICK_PANE_MOUNTED_ATTR\] = "1"/);
    expect(pane).toMatch(/window\.addEventListener\(NICK_PANE_OPEN_EVENT, onOpen\)/);
    expect(pane).toMatch(/hidden md:inline-flex/);
  });
});
