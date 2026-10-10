/**
 * 09-F26 (2026-10-10): the tab swipe and pull-to-refresh in components/layout/swipe-navigation.tsx
 * fired from anywhere. A flick inside a code block or a horizontal chip row changed tabs, a drag
 * in a textarea could too, and on /chat (fixed shell, window.scrollY is always 0) every downward
 * history drag past 120px called router.refresh(). The guards are pure so they run here.
 */
import { describe, expect, it } from "vitest";
import {
  pullToRefreshAllowed,
  swipeStartsInExemptZone,
  type SwipeNode,
} from "@/components/layout/swipe-navigation";

function node(over: Partial<SwipeNode> & { attrs?: string[] } = {}, parent: SwipeNode | null = null): SwipeNode {
  const attrs = new Set(over.attrs ?? []);
  return {
    tagName: over.tagName ?? "DIV",
    isContentEditable: over.isContentEditable ?? false,
    scrollWidth: over.scrollWidth ?? 100,
    clientWidth: over.clientWidth ?? 100,
    parentElement: parent,
    hasAttribute: (name: string) => attrs.has(name),
  };
}

const overflowOf = (map: Map<SwipeNode, string>) => (el: SwipeNode) => map.get(el) ?? "visible";

describe("swipeStartsInExemptZone", () => {
  it("PLANTED NEGATIVE · a touch on plain page content still swipes", () => {
    const page = node();
    const card = node({}, page);
    expect(swipeStartsInExemptZone(card, overflowOf(new Map()))).toBe(false);
    expect(swipeStartsInExemptZone(null, overflowOf(new Map()))).toBe(false);
  });

  it("ignores a touch that starts inside a horizontal scroller that actually overflows", () => {
    const row = node({ scrollWidth: 900, clientWidth: 390 });
    const chip = node({}, row);
    expect(swipeStartsInExemptZone(chip, overflowOf(new Map([[row, "auto"]])))).toBe(true);
  });

  it("a scroll container whose content fits does not block the swipe", () => {
    const row = node({ scrollWidth: 390, clientWidth: 390 });
    expect(swipeStartsInExemptZone(node({}, row), overflowOf(new Map([[row, "auto"]])))).toBe(false);
  });

  it("wide content that is not a scroller (overflow visible/hidden) does not block the swipe", () => {
    const wide = node({ scrollWidth: 900, clientWidth: 390 });
    expect(swipeStartsInExemptZone(node({}, wide), overflowOf(new Map([[wide, "hidden"]])))).toBe(false);
  });

  it("ignores touches in text entry: input, textarea, contenteditable", () => {
    const none = overflowOf(new Map());
    expect(swipeStartsInExemptZone(node({ tagName: "INPUT" }), none)).toBe(true);
    expect(swipeStartsInExemptZone(node({ tagName: "TEXTAREA" }), none)).toBe(true);
    expect(swipeStartsInExemptZone(node({ isContentEditable: true }), none)).toBe(true);
  });

  it("ignores touches inside an opted-out [data-no-swipe] region", () => {
    const region = node({ attrs: ["data-no-swipe"] });
    expect(swipeStartsInExemptZone(node({}, node({}, region)), overflowOf(new Map()))).toBe(true);
  });
});

describe("pullToRefreshAllowed", () => {
  it("is off on /chat, whose fixed shell keeps window.scrollY at 0", () => {
    expect(pullToRefreshAllowed("/chat")).toBe(false);
    expect(pullToRefreshAllowed("/chat/abc")).toBe(false);
  });

  it("stays on for scrolling pages (and a lookalike route)", () => {
    expect(pullToRefreshAllowed("/")).toBe(true);
    expect(pullToRefreshAllowed("/missions")).toBe(true);
    expect(pullToRefreshAllowed("/chatter")).toBe(true);
  });
});
