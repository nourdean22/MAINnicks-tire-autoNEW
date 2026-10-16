/**
 * UI v3 W1b: a pulse-sheet row with an href navigates client-side (next/link), not with a bare
 * anchor that reloads the whole PWA. Under node SSR next/link renders the same <a> a bare anchor
 * would, so the test swaps next/link for a marker anchor and asserts the marker is on the row.
 * The Base UI dialog is a pass-through here, as in more-sheet-pulse.test.tsx.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRef } from "react";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) =>
      React.createElement("a", { href, "data-next-link": "", ...rest }, children),
  };
});
vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  return {
    Dialog: (p: { open: boolean; children: React.ReactNode }) => (p.open ? React.createElement("div", null, p.children) : null),
    DialogContent: (p: { children: React.ReactNode }) => React.createElement("div", { role: "dialog" }, p.children),
    DialogTitle: (p: { children: React.ReactNode }) => React.createElement("h2", null, p.children),
  };
});
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    operator: {
      personalPulse: { useQuery: () => ({ data: null, isError: false, refetch: vi.fn() }) },
      ticker: { useQuery: () => ({ data: null, isError: false }) },
      resolveCommitment: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/use-dismissed-ticker", () => ({
  useDismissedTicker: () => ({ dismissed: new Set<string>(), dismiss: vi.fn() }),
}));
vi.mock("@/lib/state/nour-state", () => ({ useNourState: () => ({ currentState: "focus", setState: vi.fn() }) }));

import { PulseFeedSheet } from "@/components/ultron/bottom-pulse-ticker";

type Item = Parameters<typeof PulseFeedSheet>[0]["items"][number];
const linked: Item = { id: "a", kind: "reflection", glyph: "o", label: "BRAIN", text: "go read it", tone: "info", href: "/brain" } as Item;
const plain: Item = { id: "b", kind: "reflection", glyph: "o", label: "BRAIN", text: "nothing to open", tone: "info" } as Item;

const render = (items: Item[]) =>
  renderToStaticMarkup(
    <PulseFeedSheet
      open
      items={items}
      activeIdx={0}
      onClose={() => {}}
      onDismiss={() => {}}
      onResolve={() => {}}
      resolvingId={null}
      onPick={() => {}}
      returnFocusRef={createRef<HTMLButtonElement>()}
    />,
  );

describe("PulseFeedSheet rows", () => {
  it("a row with an href is a next/link Link that keeps its aria-label", () => {
    const html = render([linked]);
    expect(html).toMatch(/<a href="\/brain" data-next-link="" [^>]*aria-label="BRAIN: go read it"/);
  });

  it("a row without an href stays a button (no Link, no bare anchor)", () => {
    const html = render([plain]);
    expect(html).not.toContain("data-next-link");
    expect(html).not.toMatch(/<a /);
    expect(html).toContain("<button");
  });

  it("the Link row still closes the sheet on tap (onClick={onClose} is not renderable, so pin the source)", () => {
    const src = readFileSync(join(process.cwd(), "components/ultron/bottom-pulse-ticker.tsx"), "utf8");
    const row = src.slice(src.indexOf("{it.href ? ("), src.indexOf(") : (", src.indexOf("{it.href ? (")));
    expect(row).toContain("<Link");
    expect(row).toContain("onClick={onClose}");
    expect(row).toContain("aria-label={`${it.label}: ${it.text}`}");
    expect(row).not.toMatch(/<a\b/);
  });
});
