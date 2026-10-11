/**
 * MoreSheet is mounted on every (mastery) page. It used to call useSystemPulse at its top level, so every page
 * polled system.pulse every 30 s while the sheet sat closed (audit 10-X5). The pulse only feeds the "Now" row, so
 * the subscription belongs inside the dialog content, which Base UI unmounts while closed.
 *
 * Base UI portals render nothing under node SSR, so the dialog is a pass-through that renders children only while
 * open (the primitive's unmount-when-closed behaviour). The store is mocked because zustand serves its initial
 * snapshot during SSR.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ open: false }));
const useSystemPulse = vi.hoisted(() => vi.fn(() => null));

vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  return {
    Dialog: (p: { open: boolean; children: React.ReactNode }) =>
      p.open ? React.createElement("div", { "data-dialog-root": "" }, p.children) : null,
    DialogContent: (p: { children: React.ReactNode }) => React.createElement("div", { role: "dialog" }, p.children),
    DialogTitle: (p: { children: React.ReactNode }) => React.createElement("h2", null, p.children),
  };
});
vi.mock("@/lib/state/more-sheet-store", () => ({
  useMoreSheetStore: (sel: (s: { open: boolean; closeSheet: () => void }) => unknown) =>
    sel({ open: state.open, closeSheet: () => {} }),
}));
vi.mock("@/lib/hooks/use-system-pulse", () => ({ useSystemPulse }));
vi.mock("@/lib/hooks/use-recent-pages", () => ({ useRecentPages: () => ({ candidates: [] }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/journal" }));
vi.mock("@/components/command-palette", () => ({ COMMAND_PALETTE_OPEN_EVENT: "cmdk:open" }));
vi.mock("@/components/brain-dump-modal", () => ({ CAPTURE_OPEN_EVENT: "capture:open" }));
vi.mock("@/components/mastery/nick-side-pane", () => ({
  NICK_PANE_OPEN_EVENT: "nick:open",
  NICK_PANE_MOUNTED_ATTR: "nickPane",
}));

import { MoreSheet } from "@/components/layout/more-sheet";

beforeEach(() => {
  useSystemPulse.mockClear();
});

describe("MoreSheet system.pulse subscription", () => {
  it("does not subscribe to the pulse while the sheet is closed", () => {
    state.open = false;
    renderToStaticMarkup(<MoreSheet />);
    expect(useSystemPulse).not.toHaveBeenCalled();
  });

  it("subscribes once the sheet is open (the Now row still gets its data)", () => {
    state.open = true;
    const html = renderToStaticMarkup(<MoreSheet />);
    expect(useSystemPulse).toHaveBeenCalled();
    expect(html).toContain("More navigation");
  });
});
