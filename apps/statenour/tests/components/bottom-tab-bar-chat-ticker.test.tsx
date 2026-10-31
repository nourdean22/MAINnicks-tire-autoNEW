// @vitest-environment jsdom
/**
 * U1 (2026-10-30) · /chat has no pulse ticker: it rotated every 10 s under the composer and cost the
 * conversation a strip of height on every screen. Every other page keeps it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ path: "/" as string }));
vi.mock("next/navigation", () => ({ usePathname: () => h.path }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/components/ultron/bottom-pulse-ticker", () => ({ BottomPulseTicker: () => <div data-ticker /> }));
vi.mock("@/lib/state/more-sheet-store", () => ({ useMoreSheetStore: (sel: (s: { openSheet: () => void }) => unknown) => sel({ openSheet: () => {} }) }));
vi.mock("@/lib/state/pinned-tab-store", () => ({
  usePinnedTabStore: (sel: (s: { href: string; hydrate: () => void }) => unknown) => sel({ href: "/journal", hydrate: () => {} }),
}));

import { BottomTabBar } from "@/components/layout/bottom-tab-bar";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("bottom chrome on /chat (U1)", () => {
  it("no ticker on /chat or a chat sub-route", () => {
    for (const path of ["/chat", "/chat/abc"]) {
      h.path = path;
      act(() => root.render(<BottomTabBar />));
      expect(container.querySelector("[data-ticker]")).toBeNull();
    }
  });
  it("CONTROL: the ticker stays on other pages", () => {
    h.path = "/journal";
    act(() => root.render(<BottomTabBar />));
    expect(container.querySelector("[data-ticker]")).not.toBeNull();
  });
});
