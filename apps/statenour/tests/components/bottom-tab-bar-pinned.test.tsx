/**
 * UI v3 W1b: the bottom bar as rendered. Three fixed tabs, one pinned slot (default Journal), and
 * a fifth "Command" slot that opens the More sheet. Rendered with renderToStaticMarkup, the server
 * path: the store is mocked at Journal for the hydration case and at a pin for the others.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ path: "/" as string, pinned: "/journal" as string }));

vi.mock("next/navigation", () => ({ usePathname: () => h.path }));
vi.mock("@/components/ultron/bottom-pulse-ticker", () => ({ BottomPulseTicker: () => null }));
vi.mock("@/lib/state/more-sheet-store", () => ({
  useMoreSheetStore: (sel: (s: { openSheet: () => void }) => unknown) => sel({ openSheet: () => {} }),
}));
vi.mock("@/lib/state/pinned-tab-store", () => ({
  usePinnedTabStore: (sel: (s: { href: string; hydrate: () => void }) => unknown) => sel({ href: h.pinned, hydrate: () => {} }),
}));

import { BottomTabBar } from "@/components/layout/bottom-tab-bar";

const render = () => renderToStaticMarkup(<BottomTabBar />);
const nav = (html: string) => html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
const labels = (html: string) => [...nav(html).matchAll(/<span class="text-\[11px\] font-medium leading-none">([^<]+)<\/span>/g)].map((m) => m[1]);
const commandButton = (html: string) => {
  const at = html.indexOf('aria-label="Command: all surfaces and search"');
  const start = html.lastIndexOf("<button", at);
  return html.slice(start, html.indexOf("</button>", at));
};

afterEach(() => {
  h.path = "/";
  h.pinned = "/journal";
});

describe("BottomTabBar slots", () => {
  it("renders Home, Chat, Missions, Journal, Command by default (the server render)", () => {
    expect(labels(render())).toEqual(["Home", "Chat", "Missions", "Journal", "Command"]);
  });

  it("the pinned slot shows the pinned entry in Journal's place", () => {
    h.pinned = "/stats";
    const html = render();
    expect(labels(html)).toEqual(["Home", "Chat", "Missions", "Stats", "Command"]);
    expect(html).toContain('href="/stats"');
    expect(html).not.toContain('href="/journal"');
  });

  it("a stale pin falls back to Journal", () => {
    h.pinned = "/market";
    expect(labels(render())).toEqual(["Home", "Chat", "Missions", "Journal", "Command"]);
  });

  it("the pinned slot gets the notch when it is the current page, like any other tab", () => {
    h.pinned = "/people";
    h.path = "/people";
    const html = render();
    const people = html.match(/<a [^>]*href="\/people"[^>]*>/)?.[0] ?? "";
    expect(people).toContain('aria-current="page"');
    expect((html.match(/bg-accent/g) ?? []).length).toBe(1);
  });
});

describe("the Command slot", () => {
  it("is a button labelled Command with a plain-colon aria-label and the search glyph", () => {
    const html = render();
    const btn = commandButton(html);
    expect(btn).toContain("Command");
    expect(btn).toContain("lucide-search");
    expect(html).not.toContain("More —");
    expect(html).not.toContain("—");
    expect(html).not.toContain("LayoutGrid");
    expect(html).not.toContain("lucide-layout-grid");
  });

  it("never carries the notch or aria-current, whatever the route (it is not a page)", () => {
    for (const path of ["/", "/journal", "/system/actions", "/stats"]) {
      h.path = path;
      const btn = commandButton(render());
      expect(btn).not.toContain("bg-accent");
      expect(btn).not.toContain("aria-current");
    }
  });

  it("keeps the 44 px floor and the spring press like the tabs", () => {
    const btn = commandButton(render());
    expect(btn).toContain("min-h-[52px]");
    expect(btn).toContain("press-spring");
  });
});
