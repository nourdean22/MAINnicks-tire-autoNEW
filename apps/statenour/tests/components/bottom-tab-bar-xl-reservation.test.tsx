// @vitest-environment jsdom
/**
 * UI v3 W3b, design decision 6: at xl the chat shell's bottom reservation is the ticker's height
 * only, never the 6rem CSS default. Two facts make that true, and both are pinned here because
 * the pre-read inferred a 96px dead band under the composer at 1440:
 *   1. --bottom-chrome-h is PUBLISHED from the measured chrome element (bottom-tab-bar.tsx), so once
 *      the bar mounts the reservation equals what is rendered, not the token's SSR fallback.
 *   2. The tab row (nav[aria-label="Primary"]) carries xl:hidden and the ticker is the only other
 *      child of the measured element, so at xl the measurement IS the ticker plus the safe area.
 * The chat page reserves `pb-[var(--bottom-chrome-h)]`, so it inherits both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ height: 20 }));

vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ultron/bottom-pulse-ticker", () => ({ BottomPulseTicker: () => <div data-ticker /> }));
vi.mock("@/lib/state/more-sheet-store", () => ({
  useMoreSheetStore: (sel: (s: { openSheet: () => void }) => unknown) => sel({ openSheet: () => {} }),
}));
vi.mock("@/lib/state/pinned-tab-store", () => ({
  usePinnedTabStore: (sel: (s: { href: string; hydrate: () => void }) => unknown) => sel({ href: "/journal", hydrate: () => {} }),
}));

import { BottomTabBar } from "@/components/layout/bottom-tab-bar";

let container: HTMLDivElement;
let root: Root;
const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  document.documentElement.style.removeProperty("--bottom-chrome-h");
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { ...originalRect.call(this), height: h.height, top: 0, bottom: h.height } as DOMRect;
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  vi.unstubAllGlobals();
});

describe("the bottom reservation at xl", () => {
  it("publishes the MEASURED chrome height into --bottom-chrome-h, not the 6rem default", () => {
    h.height = 20;
    act(() => root.render(<BottomTabBar />));
    expect(document.documentElement.style.getPropertyValue("--bottom-chrome-h")).toBe("20px");
  });

  it("the tab row is hidden at xl and the ticker is the measured element's only other child, so the xl reservation is the ticker", () => {
    act(() => root.render(<BottomTabBar />));
    const nav = container.querySelector('nav[aria-label="Primary"]') as HTMLElement;
    expect(nav.className.split(/\s+/)).toContain("xl:hidden");
    const measured = nav.parentElement as HTMLElement;
    expect(measured.className.split(/\s+/)).toContain("fixed");
    const others = [...measured.children].filter((c) => c !== nav);
    expect(others.map((c) => c.hasAttribute("data-ticker"))).toEqual([true]);
  });

  it("the chat shell reserves that measured token and nothing else at the bottom", () => {
    const page = readFileSync(join(__dirname, "..", "..", "app/(mastery)/chat/page.tsx"), "utf8");
    const root = page.match(/return \(\s*<div([^>]*)>/)![1];
    expect(root).toContain("pb-[var(--bottom-chrome-h)]");
    expect(root).not.toMatch(/\bxl:pb-/);
  });
});
