// @vitest-environment jsdom
/**
 * UI v3 W1b: the bottom bar as rendered and as clicked. Three fixed tabs, one pinned slot (default
 * Journal), and a fifth "Command" slot that opens the More sheet. Rendered with react-dom/client in
 * jsdom (the chat-message-list-feedback pattern) so the click wiring and the mount effect are
 * asserted, not only the markup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ path: "/" as string, pinned: "/journal" as string, openSheet: vi.fn(), hydrate: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: () => h.path }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ultron/bottom-pulse-ticker", () => ({ BottomPulseTicker: () => null }));
vi.mock("@/lib/state/more-sheet-store", () => ({
  useMoreSheetStore: (sel: (s: { openSheet: () => void }) => unknown) => sel({ openSheet: h.openSheet }),
}));
vi.mock("@/lib/state/pinned-tab-store", () => ({
  usePinnedTabStore: (sel: (s: { href: string; hydrate: () => void }) => unknown) => sel({ href: h.pinned, hydrate: h.hydrate }),
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
  h.path = "/";
  h.pinned = "/journal";
  h.openSheet.mockClear();
  h.hydrate.mockClear();
});

const render = () => {
  act(() => {
    root.render(<BottomTabBar />);
  });
  return container;
};
const labels = (el: HTMLElement) =>
  [...el.querySelectorAll('nav[aria-label="Primary"] > a, nav[aria-label="Primary"] > button')].map((n) => n.textContent?.trim());
const command = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button[aria-label="Command: all surfaces and search"]');
const click = (el: Element) => {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("BottomTabBar slots", () => {
  it("renders Home, Chat, Missions, Journal, Command by default (the first client render)", () => {
    expect(labels(render())).toEqual(["Home", "Chat", "Missions", "Journal", "Command"]);
  });

  it("hydrates the pinned slot once on mount", () => {
    render();
    expect(h.hydrate).toHaveBeenCalledTimes(1);
  });

  it("the pinned slot shows the pinned entry in Journal's place", () => {
    h.pinned = "/stats";
    const el = render();
    expect(labels(el)).toEqual(["Home", "Chat", "Missions", "Stats", "Command"]);
    expect(el.querySelector('a[href="/stats"]')).not.toBeNull();
    expect(el.querySelector('a[href="/journal"]')).toBeNull();
  });

  it("a stale pin falls back to Journal", () => {
    h.pinned = "/market";
    expect(labels(render())).toEqual(["Home", "Chat", "Missions", "Journal", "Command"]);
  });

  it("the pinned slot gets the notch when it is the current page, like any other tab", () => {
    h.pinned = "/people";
    h.path = "/people";
    const el = render();
    const people = el.querySelector('a[href="/people"]')!;
    expect(people.getAttribute("aria-current")).toBe("page");
    expect(el.querySelectorAll(".bg-accent").length).toBe(1);
    expect(people.querySelector(".bg-accent")).not.toBeNull();
  });
});

describe("the Command slot", () => {
  it("is a type=button labelled Command with a plain-colon aria-label, aria-haspopup=dialog and the search glyph", () => {
    const el = render();
    const btn = command(el)!;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    expect(btn.textContent).toContain("Command");
    expect(btn.querySelector("svg.lucide-search")).not.toBeNull();
    expect(el.innerHTML).not.toContain("—");
    expect(el.querySelector("svg.lucide-layout-grid")).toBeNull();
  });

  it("opens the More sheet when activated", () => {
    const el = render();
    click(command(el)!);
    expect(h.openSheet).toHaveBeenCalledTimes(1);
  });

  it("never carries the notch or aria-current, whatever the route (it is not a page)", () => {
    for (const path of ["/", "/journal", "/system/actions", "/stats"]) {
      h.path = path;
      const btn = command(render())!;
      expect(btn).not.toBeNull();
      expect(btn.querySelector(".bg-accent")).toBeNull();
      expect(btn.hasAttribute("aria-current")).toBe(false);
    }
  });

  it("keeps the 44 px floor and the spring press like the tabs", () => {
    const btn = command(render())!;
    expect(btn.className).toContain("min-h-[52px]");
    expect(btn.className).toContain("press-spring");
  });
});
