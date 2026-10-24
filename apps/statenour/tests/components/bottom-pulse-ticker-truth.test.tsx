// @vitest-environment jsdom
/**
 * Truth sweep 2026-10-23, acceptance 1: the bottom ticker.
 *
 *  · A failed sub-feed beside a working one was hidden: the strip showed the working one's items
 *    with no sign the other was down. It now says "1 feed down".
 *  · Done / Drop on a promise had no onError: a rejected resolve looked like nothing happened.
 *  · The strip is control chrome on a fixed bar; SYSTEM.md does not list it for `.ui-material`
 *    blur, so it is a solid surface.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  pulse: null as null | { items: unknown[] },
  ticker: null as null | { items: unknown[]; softError?: string },
  pulseError: false,
  tickerError: false,
  mutationOpts: null as null | { onError?: (e: unknown) => void; onSuccess?: () => void },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    operator: {
      personalPulse: { useQuery: () => ({ data: h.pulse ?? undefined, isError: h.pulseError, refetch: vi.fn() }) },
      ticker: { useQuery: () => ({ data: h.ticker ?? undefined, isError: h.tickerError }) },
      resolveCommitment: {
        useMutation: (opts: { onError?: (e: unknown) => void }) => {
          h.mutationOpts = opts;
          return { mutate: vi.fn(), isPending: false };
        },
      },
    },
  },
}));
vi.mock("@/hooks/use-dismissed-ticker", () => ({
  useDismissedTicker: () => ({ dismissed: new Set<string>(), dismiss: vi.fn() }),
}));
vi.mock("@/lib/state/nour-state", () => ({ useNourState: () => ({ currentState: "focus", setState: vi.fn() }) }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: (p: { open: boolean; children: React.ReactNode }) => (p.open ? <div data-dialog-root>{p.children}</div> : null),
  DialogContent: (p: { children: React.ReactNode }) => <div role="dialog">{p.children}</div>,
  DialogTitle: (p: { children: React.ReactNode }) => <h2>{p.children}</h2>,
}));

import { BottomPulseTicker } from "@/components/ultron/bottom-pulse-ticker";

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "reflection",
  glyph: "o",
  label: "BRAIN",
  text: `item ${id}`,
  tone: "info",
  ...extra,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<BottomPulseTicker />));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  h.pulse = null;
  h.ticker = null;
  h.pulseError = false;
  h.tickerError = false;
  h.mutationOpts = null;
});

describe("partial failure", () => {
  it("one sub-feed failed beside a working one: the strip says one feed is down and still shows the working items", () => {
    h.tickerError = true;
    h.pulse = { items: [item("a")] };
    const text = mount().textContent ?? "";
    expect(text).toContain("item a");
    expect(text).toContain("1 feed down");
  });
  it("the softError ticker counts as down too", () => {
    h.pulse = { items: [item("a")] };
    h.ticker = { items: [], softError: "feeds unavailable" };
    expect(mount().textContent).toContain("1 feed down");
  });
  it("control: both feeds fine says nothing about a feed", () => {
    h.pulse = { items: [item("a")] };
    h.ticker = { items: [] };
    expect(mount().textContent).not.toContain("feed down");
  });
});

describe("the sheet's feed note is true for what is on screen (review F4)", () => {
  const tickerItem = { id: "t1", category: "shop", label: "SHOP open", severity: "info", href: "/x" };
  const openSheet = () => {
    const el = mount();
    act(() => (el.querySelector('button[aria-label="Open pulse feed"]') as HTMLButtonElement).click());
    return el.textContent ?? "";
  };

  it("a feed whose refresh failed over cached items says 'could not refresh', not 'could not load'", () => {
    h.tickerError = true; // react-query keeps the last good data beside isError
    h.ticker = { items: [tickerItem] };
    h.pulse = { items: [item("a")] };
    const text = openSheet();
    expect(text).toContain("Market ticker could not refresh.");
    expect(text).not.toContain("could not load");
    expect(text).toContain("SHOP open");
  });
  it("a feed with nothing cached says 'could not load'", () => {
    h.pulseError = true;
    h.ticker = { items: [tickerItem] };
    const text = openSheet();
    expect(text).toContain("Personal pulse could not load.");
    expect(text).not.toContain("could not refresh");
  });
  it("never claims the items come from the other feed (cached items of the failed feed show too)", () => {
    h.tickerError = true;
    h.ticker = { items: [tickerItem] };
    h.pulse = { items: [item("a")] };
    expect(openSheet()).not.toContain("come from the other feed");
  });
  it("both feeds failed over cache: names both", () => {
    h.pulseError = true;
    h.tickerError = true;
    h.pulse = { items: [item("a")] };
    h.ticker = { items: [tickerItem] };
    const text = openSheet();
    expect(text).toContain("Personal pulse could not refresh.");
    expect(text).toContain("Market ticker could not refresh.");
  });
});

describe("Done / Drop", () => {
  it("a rejected resolve is shown in the sheet where the tap happened", () => {
    h.pulse = { items: [item("c1", { kind: "commitment", commitmentId: 7, label: "PROMISE", text: "send the quote" })] };
    const el = mount();
    expect(typeof h.mutationOpts?.onError).toBe("function");
    act(() => (el.querySelector('button[aria-label="Open pulse feed"]') as HTMLButtonElement).click());
    expect(el.textContent).not.toContain("Could not update that promise");
    act(() => h.mutationOpts!.onError!(new Error("rejected")));
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Could not update that promise. Try again.");
  });
});

describe("surface", () => {
  it("the fixed strip is a solid surface, not .ui-material blur", () => {
    h.pulse = { items: [item("a")] };
    expect(mount().innerHTML).not.toContain("ui-material");
  });
  it("the failure strip is solid too", () => {
    h.pulseError = true;
    h.tickerError = true;
    const html = mount().innerHTML;
    expect(html).toContain("Pulse unavailable");
    expect(html).not.toContain("ui-material");
  });
});
