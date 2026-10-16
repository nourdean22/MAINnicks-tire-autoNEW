/**
 * UI v3 W1b: the More sheet's Pin control. Every pinnable row carries a 44 px "Pin <label> to the
 * tab bar" button beside its link (a sibling, never nested in the anchor, so a tap on it cannot
 * navigate and Tab reaches both). The pinned entry is not a row; Journal takes its place in Reflect.
 * Mocks follow more-sheet-pulse.test.tsx.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ pinned: "/journal" as string, pin: vi.fn() }));

vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  return {
    Dialog: (p: { open: boolean; children: React.ReactNode }) => (p.open ? React.createElement("div", null, p.children) : null),
    DialogContent: (p: { children: React.ReactNode }) => React.createElement("div", { role: "dialog" }, p.children),
    DialogTitle: (p: { children: React.ReactNode }) => React.createElement("h2", null, p.children),
  };
});
vi.mock("@/lib/state/more-sheet-store", () => ({
  useMoreSheetStore: (sel: (s: { open: boolean; closeSheet: () => void }) => unknown) => sel({ open: true, closeSheet: () => {} }),
}));
vi.mock("@/lib/state/pinned-tab-store", () => ({
  usePinnedTabStore: (sel: (s: { href: string; pin: (href: string) => void }) => unknown) => sel({ href: h.pinned, pin: h.pin }),
}));
vi.mock("@/lib/hooks/use-system-pulse", () => ({ useSystemPulse: () => null }));
vi.mock("@/lib/hooks/use-recent-pages", () => ({ useRecentPages: () => ({ candidates: [] }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/journal" }));
vi.mock("@/components/command-palette", () => ({ COMMAND_PALETTE_OPEN_EVENT: "cmdk:open" }));
vi.mock("@/components/brain-dump-modal", () => ({ CAPTURE_OPEN_EVENT: "capture:open" }));
vi.mock("@/components/mastery/nick-side-pane", () => ({ NICK_PANE_OPEN_EVENT: "nick:open", NICK_PANE_MOUNTED_ATTR: "nickPane" }));

import { MoreSheet } from "@/components/layout/more-sheet";

const render = () => renderToStaticMarkup(<MoreSheet />);
const pinButton = (html: string, label: string) => {
  const at = html.indexOf(`aria-label="Pin ${label} to the tab bar"`);
  if (at < 0) return null;
  const start = html.lastIndexOf("<button", at);
  return html.slice(start, html.indexOf("</button>", at));
};

afterEach(() => {
  h.pinned = "/journal";
  h.pin.mockClear();
});

describe("MoreSheet pin control", () => {
  it("every flat row has a Pin button; hubs and Settings do not", () => {
    const html = render();
    for (const label of ["Stats", "Pinned Memory", "Learn", "Photo Improver", "Short Links", "People", "Proof"]) {
      expect(pinButton(html, label), label).not.toBeNull();
    }
    expect(pinButton(html, "Brain")).toBeNull();
    expect(pinButton(html, "Content")).toBeNull();
    expect(pinButton(html, "System")).toBeNull();
    expect(pinButton(html, "Settings")).toBeNull();
  });

  it("the Pin button is a 44 px icon button with a visible focus ring, beside the link, not inside it", () => {
    const html = render();
    const btn = pinButton(html, "People")!;
    expect(btn).toContain('type="button"');
    expect(btn).toContain("h-11 w-11");
    expect(btn).toContain("focus-visible:ring");
    expect(btn).toContain("lucide-pin");
    const linkStart = html.indexOf('href="/people"');
    const linkEnd = html.indexOf("</a>", linkStart);
    expect(html.slice(linkStart, linkEnd)).not.toContain("<button");
    expect(html.indexOf('aria-label="Pin People to the tab bar"')).toBeGreaterThan(linkEnd);
  });

  it("with the default pin, Journal is not a row and has no Pin button", () => {
    const html = render();
    expect(html).not.toContain('href="/journal"');
    expect(pinButton(html, "Journal")).toBeNull();
  });

  it("the pinned entry leaves the rows and Journal appears with its own Pin button", () => {
    h.pinned = "/stats";
    const html = render();
    expect(html).not.toContain('href="/stats"');
    expect(pinButton(html, "Stats")).toBeNull();
    expect(html).toContain('href="/journal"');
    expect(pinButton(html, "Journal")).not.toBeNull();
  });

  it("a stale pin behaves as the default", () => {
    h.pinned = "/market";
    const html = render();
    expect(html).toContain('href="/stats"');
    expect(html).not.toContain('href="/journal"');
  });

  it("writes no em dash and no emoji (the ratchets stay at zero for this file)", () => {
    const html = render();
    expect(html).not.toContain("—");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
