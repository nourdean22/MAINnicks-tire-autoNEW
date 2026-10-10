/**
 * PulseFeedSheet · 2026-10-10 rewrite (audit 09-F4).
 *
 * The sheet used to be a hand-rolled overlay: a transparent click-catcher div, a window keydown
 * listener for Escape, and a `mounted` state machine that unmounted on animationend (whose failure
 * mode was a permanent ghost sheet). Focus never moved into it, was never trapped, and was never
 * returned. It now runs on the Base UI Dialog the More sheet uses, so focus entry, the trap,
 * Escape / outside dismissal, scroll lock and focus return come from the primitive, and unmount
 * no longer depends on an animation event.
 *
 * Vitest runs in node and Base UI portals render nothing on the server, so the dialog module is
 * replaced by a pass-through that records its props. What this pins is the WIRING: the sheet
 * renders inside the dialog only while open, every dismissal Base UI reports reaches onClose,
 * focus returns to the strip button the caller passes, and the rows keep their actions.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRef } from "react";

const seen = vi.hoisted(() => ({
  root: null as null | { open: boolean; onOpenChange: (open: boolean, details?: unknown) => void },
  content: null as null | { className?: string; finalFocus?: unknown },
}));

vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  return {
    Dialog: (p: { open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode }) => {
      seen.root = p;
      return p.open ? React.createElement("div", { "data-dialog-root": "" }, p.children) : null;
    },
    DialogContent: (p: { className?: string; finalFocus?: unknown; children: React.ReactNode }) => {
      seen.content = p;
      return React.createElement("div", { role: "dialog", className: p.className }, p.children);
    },
    DialogTitle: (p: { className?: string; children: React.ReactNode }) => React.createElement("h2", { className: p.className }, p.children),
  };
});

import { PulseFeedSheet } from "@/components/ultron/bottom-pulse-ticker";

const ITEMS = [
  {
    id: "commit-1",
    kind: "commitment" as const,
    glyph: "*",
    label: "PROMISE",
    text: "ship the weekly review",
    tone: "warn" as const,
    commitmentId: 42,
  },
  {
    id: "info-1",
    kind: "win" as const,
    glyph: "+",
    label: "WIN",
    text: "streak held",
    tone: "win" as const,
    href: "/journal",
  },
];

function render(open: boolean, onClose = vi.fn(), returnFocusRef = createRef<HTMLButtonElement>()) {
  const html = renderToStaticMarkup(
    <PulseFeedSheet
      open={open}
      items={ITEMS}
      activeIdx={0}
      onClose={onClose}
      onDismiss={() => {}}
      onResolve={() => {}}
      resolvingId={null}
      onPick={() => {}}
      returnFocusRef={returnFocusRef}
    />,
  );
  return { html, onClose, returnFocusRef };
}

describe("PulseFeedSheet runs on the Base UI dialog", () => {
  it("renders the feed inside a titled dialog while open", () => {
    const { html } = render(true);
    expect(html).toContain('role="dialog"');
    expect(html).toMatch(/<h2[^>]*>Pulse · 2<\/h2>/);
    expect(html).toContain("ship the weekly review");
  });

  it("renders nothing while closed", () => {
    expect(render(false).html).toBe("");
  });

  it("every dismissal Base UI reports (Escape, outside press, Close) reaches onClose; an open request does not", () => {
    const { onClose } = render(true);
    seen.root!.onOpenChange(false, { reason: "escape-key" });
    expect(onClose).toHaveBeenCalledTimes(1);
    seen.root!.onOpenChange(true, { reason: "trigger-press" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the strip button that opened it", () => {
    const { returnFocusRef } = render(true);
    expect(seen.content!.finalFocus).toBe(returnFocusRef);
  });

  it("enter and exit ride the dialog's data-open / data-closed state (no animationend unmount)", () => {
    render(true);
    expect(seen.content!.className).toMatch(/\bdata-open:animate-in\b/);
    expect(seen.content!.className).toMatch(/\bdata-closed:animate-out\b/);
  });

  it("commitment rows keep their Done / Drop resolve buttons", () => {
    const { html } = render(true);
    expect(html).toContain("Mark this promise done");
    expect(html).toContain("Drop this promise");
  });
});
