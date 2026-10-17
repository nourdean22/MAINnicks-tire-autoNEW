/**
 * UI v3 Wave 4 (Mind), Brain: one compact lens row at content width, filters inside the canvas
 * (PLAN section 4 "compact content-width tab strips", audit item 8).
 *
 * THE DEFECT. The /brain lens bar wrapped (`flex-wrap`) into two rows at 390 px, each lens carried
 * an 18 px display label plus a mono hint line, and the bar ran the full page width. Under it each
 * lens drew a SECOND tab bar (its sub-sections) outside the panel, so the phone showed two strips
 * of chrome before any content.
 *
 * The fix, pinned here by what renders: one row that never wraps and scrolls instead, sized to its
 * content, 14 px labels with no hint line; the lens's sub-sections render as a filter row INSIDE
 * the tabpanel. The `?tab=` contract is unchanged (a lens click selects its first tab).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ search: "tab=memory", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, push: h.replace }),
  usePathname: () => "/brain",
  useSearchParams: () => new URLSearchParams(h.search),
}));

import { PageTabs } from "@/components/layout/page-tabs";

const TABS = [
  { key: "graph", label: "Map", render: () => <p>map body</p> },
  { key: "memory", label: "Memory", render: () => <p>memory body</p> },
  { key: "wisdom", label: "Wisdom", render: () => <p>wisdom body</p> },
  { key: "board", label: "Board", render: () => <p>board body</p> },
  { key: "reason", label: "Reason", render: () => <p>reason body</p> },
];
const LENSES = [
  { key: "graph", label: "Graph", hint: "where everything is", tabs: ["graph"], layout: "canvas" as const },
  { key: "library", label: "Library", hint: "what we believe", tabs: ["memory", "wisdom"], layout: "index" as const },
  { key: "think", label: "Think", hint: "operator cognition", tabs: ["board", "reason"], layout: "reading" as const },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(search: string): Promise<HTMLDivElement> {
  h.search = search;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<PageTabs tabs={TABS} lenses={LENSES} defaultKey="graph" />);
  });
  return container;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  h.replace.mockReset();
});

describe("PageTabs lenses: one compact row, filters inside the canvas", () => {
  it("draws the lenses as ONE row that scrolls instead of wrapping, sized to its content", async () => {
    const el = await mount("tab=memory");
    const strip = el.querySelector('[role="tablist"][aria-label="Lenses"]') as HTMLElement;
    expect(strip, "no lens strip").toBeTruthy();
    const cls = strip.className.split(/\s+/);
    expect(cls, "the strip still wraps into a second row on a phone").not.toContain("flex-wrap");
    expect(cls).toContain("flex-nowrap");
    expect(cls).toContain("overflow-x-auto");
    expect(cls, "the strip still spans the full page width").toContain("w-fit");
    expect(cls).toContain("max-w-full");
  });

  it("uses compact 14 px labels with no hint line under them, and keeps every lens a 44 px target", async () => {
    const el = await mount("tab=memory");
    const tabs = [...el.querySelectorAll('[role="tablist"][aria-label="Lenses"] [role="tab"]')] as HTMLElement[];
    expect(tabs.map((t) => t.textContent)).toEqual(["Graph", "Library", "Think"]);
    for (const t of tabs) {
      expect(t.className, `${t.textContent} label is not compact`).toContain("text-[14px]");
      expect(t.className).not.toMatch(/text-\[1[78]px\]/);
      expect(t.className).toContain("min-h-[44px]");
    }
    // Visible text only: the hint now lives in a `hidden` description node (fix round 1, below).
    const visible = el.cloneNode(true) as HTMLElement;
    visible.querySelectorAll("[hidden]").forEach((n) => n.remove());
    expect(visible.textContent, "the hint line is still drawn").not.toContain("what we believe");
    expect(visible.textContent).not.toContain("where everything is");
  });

  it("fix round 1: each lens hint is the tab's accessible description, not a mouse-only title", async () => {
    const el = await mount("tab=memory");
    const tabs = [...el.querySelectorAll('[role="tablist"][aria-label="Lenses"] [role="tab"]')] as HTMLElement[];
    for (const [i, hint] of ["where everything is", "what we believe", "operator cognition"].entries()) {
      const id = tabs[i].getAttribute("aria-describedby");
      expect(id, `${tabs[i].textContent}: no accessible description`).toBeTruthy();
      const desc = el.querySelector(`[id="${id}"]`) as HTMLElement;
      expect(desc?.textContent).toBe(hint);
      expect(desc.hidden, "the description is drawn on screen").toBe(true);
    }
  });

  it("renders the lens's sub-sections as a filter row INSIDE the tabpanel, not as a second strip above it", async () => {
    for (const [search, label] of [["tab=memory", "Library sections"], ["tab=board", "Think sections"]] as const) {
      const el = await mount(search);
      const filters = el.querySelector(`nav[aria-label="${label}"]`);
      expect(filters, `${label}: no filter row`).toBeTruthy();
      expect(filters!.closest('[role="tabpanel"]'), `${label}: the filter row sits outside the canvas`).toBeTruthy();
      await act(async () => root!.unmount());
      container?.remove();
      root = null;
    }
  });

  it("keeps the ?tab= contract: a lens selects its first tab, a filter selects its own key", async () => {
    const el = await mount("tab=memory");
    const think = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Think") as HTMLButtonElement;
    await act(async () => think.click());
    expect(h.replace).toHaveBeenLastCalledWith("/brain?tab=board", { scroll: false });
    const wisdom = [...el.querySelectorAll('nav[aria-label="Library sections"] button')].find((b) => b.textContent === "Wisdom") as HTMLButtonElement;
    await act(async () => wisdom.click());
    expect(h.replace).toHaveBeenLastCalledWith("/brain?tab=wisdom", { scroll: false });
    expect(el.textContent).toContain("memory body");
  });
});
