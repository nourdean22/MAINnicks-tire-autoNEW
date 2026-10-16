// @vitest-environment jsdom
/**
 * UI v3 W1b: the More sheet's Pin control, rendered and clicked in jsdom. Every pinnable row has
 * a "Pin <label> to the tab bar" button beside its link (a sibling, never nested in the anchor).
 * Activating it calls pin(href), announces "<Label> pinned to the tab bar" in the sheet's live
 * region and moves focus to the sheet's close button, because the row it sat in unmounts. The
 * pinned entry is not a row; Journal takes its place in Reflect. Mocks follow more-sheet-pulse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ pinned: "/journal" as string, pin: vi.fn() }));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: (p: { open: boolean; children: React.ReactNode }) => (p.open ? <div>{p.children}</div> : null),
  DialogContent: (p: { children: React.ReactNode }) => <div role="dialog">{p.children}</div>,
  DialogTitle: (p: { children: React.ReactNode }) => <h2>{p.children}</h2>,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/state/more-sheet-store", () => ({
  useMoreSheetStore: (sel: (s: { open: boolean; closeSheet: () => void }) => unknown) => sel({ open: true, closeSheet: () => {} }),
}));
vi.mock("@/lib/state/pinned-tab-store", () => ({
  usePinnedTabStore: (sel: (s: { href: string; pin: (href: string) => void }) => unknown) =>
    sel({
      href: h.pinned,
      pin: (href: string) => {
        h.pin(href);
        h.pinned = href;
      },
    }),
}));
vi.mock("@/lib/hooks/use-system-pulse", () => ({ useSystemPulse: () => null }));
vi.mock("@/lib/hooks/use-recent-pages", () => ({ useRecentPages: () => ({ candidates: [] }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/journal" }));
vi.mock("@/components/command-palette", () => ({ COMMAND_PALETTE_OPEN_EVENT: "cmdk:open" }));
vi.mock("@/components/brain-dump-modal", () => ({ CAPTURE_OPEN_EVENT: "capture:open" }));
vi.mock("@/components/mastery/nick-side-pane", () => ({ NICK_PANE_OPEN_EVENT: "nick:open", NICK_PANE_MOUNTED_ATTR: "nickPane" }));

import { MoreSheet } from "@/components/layout/more-sheet";

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
  h.pinned = "/journal";
  h.pin.mockClear();
});

const render = () => {
  act(() => {
    root.render(<MoreSheet />);
  });
  return container;
};
const pinButton = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="Pin ${label} to the tab bar"]`);
const click = (el: Element) => {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("MoreSheet pin control", () => {
  it("every flat row has a Pin button; hubs and Settings do not", () => {
    const el = render();
    for (const label of ["Stats", "Pinned Memory", "Learn", "Photo Improver", "Short Links", "People", "Proof"]) {
      expect(pinButton(el, label), label).not.toBeNull();
    }
    for (const label of ["Brain", "Content", "System", "Settings"]) expect(pinButton(el, label), label).toBeNull();
  });

  it("the Pin button is type=button, 44 px hit area with a 36 px visual, focus ring, beside the link and not inside it", () => {
    const el = render();
    const btn = pinButton(el, "People")!;
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.className).toContain("h-11 w-11");
    expect(btn.className).toContain("focus-visible:ring");
    expect(btn.querySelector("span.h-9.w-9")).not.toBeNull();
    expect(btn.querySelector("svg.lucide-pin")).not.toBeNull();
    const link = el.querySelector('a[href="/people"]')!;
    expect(link.querySelector("button")).toBeNull();
    expect(link.nextElementSibling).toBe(btn);
  });

  it("activating Pin calls pin(href) with the row's href", () => {
    const el = render();
    click(pinButton(el, "People")!);
    expect(h.pin).toHaveBeenCalledTimes(1);
    expect(h.pin).toHaveBeenCalledWith("/people");
  });

  it("after a pin the sheet announces it in a live region and focus lands on the close button", () => {
    const el = render();
    const btn = pinButton(el, "Stats")!;
    btn.focus();
    click(btn);
    const status = el.querySelector('[role="status"]')!;
    expect(status).not.toBeNull();
    expect(status.textContent).toBe("Stats pinned to the tab bar");
    expect(document.activeElement).toBe(el.querySelector('button[aria-label="Close More menu"]'));
  });

  it("with the default pin, Journal is not a row and has no Pin button", () => {
    const el = render();
    expect(el.querySelector('a[href="/journal"]')).toBeNull();
    expect(pinButton(el, "Journal")).toBeNull();
  });

  it("the pinned entry leaves the rows and Journal appears with its own Pin button", () => {
    h.pinned = "/stats";
    const el = render();
    expect(el.querySelector('a[href="/stats"]')).toBeNull();
    expect(pinButton(el, "Stats")).toBeNull();
    expect(el.querySelector('a[href="/journal"]')).not.toBeNull();
    expect(pinButton(el, "Journal")).not.toBeNull();
  });

  it("a stale pin behaves as the default", () => {
    h.pinned = "/market";
    const el = render();
    expect(el.querySelector('a[href="/stats"]')).not.toBeNull();
    expect(el.querySelector('a[href="/journal"]')).toBeNull();
  });

  it("writes no em dash and no emoji (the ratchets stay at zero for this file)", () => {
    const html = render().innerHTML;
    expect(html).not.toContain("—");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("MoreSheet row source pins (390 px: about 94 px of label beside the pin)", () => {
  const src = readFileSync(join(process.cwd(), "components/layout/more-sheet.tsx"), "utf8");
  const row = src.slice(src.indexOf("{isPinnable(n) && (") - 1200, src.indexOf("{isPinnable(n) && ("));

  it("the label keeps min-w-0 and truncate and carries a title", () => {
    expect(row).toMatch(/className="min-w-0 truncate text-\[13px\] font-medium"/);
    expect(row).toContain("title={n.label}");
  });
});
