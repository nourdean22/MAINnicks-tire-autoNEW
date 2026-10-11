/**
 * BottomPulseTicker strip · 2026-10-10 (audit 09-F30 ticker part, 09-F21 strip).
 *
 *  · F30: a failed read rendered NOTHING (`return null`), the same pixels as "no pulse today".
 *    A failure now renders a quiet "Pulse unavailable" line; an empty, healthy read still renders
 *    nothing (the control below proves that branch stayed real).
 *  · F21: the strip's tap target was the strip height (32px phone, 20px desktop), so it carried a
 *    `data-target-audit="exempt"` opt-out of the 44px e2e audit. Its three controls now have a
 *    real 44px phone box and the opt-out is gone.
 *
 * Data hooks mocked the same way tests/components/mobile-a11y.test.tsx does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const feeds = vi.hoisted(() => ({
  pulse: null as null | { items: unknown[] },
  ticker: null as null | { items: unknown[]; softError?: string },
  pulseError: false,
  tickerError: false,
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    operator: {
      personalPulse: { useQuery: () => ({ data: feeds.pulse, isError: feeds.pulseError, refetch: vi.fn() }) },
      ticker: { useQuery: () => ({ data: feeds.ticker, isError: feeds.tickerError }) },
      resolveCommitment: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/use-dismissed-ticker", () => ({
  useDismissedTicker: () => ({ dismissed: new Set<string>(), dismiss: vi.fn() }),
}));
vi.mock("@/lib/state/nour-state", () => ({
  useNourState: () => ({ currentState: "focus", setState: vi.fn() }),
}));

import { BottomPulseTicker } from "@/components/ultron/bottom-pulse-ticker";

const item = (id: string) => ({ id, kind: "reflection", glyph: "o", label: "BRAIN", text: `item ${id}`, tone: "info" });

afterEach(() => {
  feeds.pulse = null;
  feeds.ticker = null;
  feeds.pulseError = false;
  feeds.tickerError = false;
});

describe("F30 · a failed pulse read says so", () => {
  it("both feeds failed: a quiet 'Pulse unavailable' line in the same landmark", () => {
    feeds.pulseError = true;
    feeds.tickerError = true;
    const html = renderToStaticMarkup(<BottomPulseTicker />);
    expect(html).toContain('aria-label="System pulse"');
    expect(html).toContain("Pulse unavailable");
  });

  it("one feed failed and the other has nothing: still unavailable, not 'all quiet'", () => {
    feeds.pulseError = true;
    feeds.ticker = { items: [] };
    expect(renderToStaticMarkup(<BottomPulseTicker />)).toContain("Pulse unavailable");
  });

  it("09-F30: every ticker sub-feed failed (softError) and the personal pulse is empty: unavailable, not silent", () => {
    feeds.pulse = { items: [] };
    feeds.ticker = { items: [], softError: "feeds unavailable" };
    expect(renderToStaticMarkup(<BottomPulseTicker />)).toContain("Pulse unavailable");
  });

  it("control · both feeds empty and healthy: nothing renders (the null branch is real)", () => {
    feeds.pulse = { items: [] };
    feeds.ticker = { items: [] };
    expect(renderToStaticMarkup(<BottomPulseTicker />)).toBe("");
  });

  it("a failed feed beside a working one shows the working one's items", () => {
    feeds.tickerError = true;
    feeds.pulse = { items: [item("a")] };
    const html = renderToStaticMarkup(<BottomPulseTicker />);
    expect(html).toContain("item a");
    expect(html).not.toContain("Pulse unavailable");
  });
});

describe("F21 · the strip's controls are 44px on a phone, so no audit exemption", () => {
  it("renders no data-target-audit opt-out", () => {
    feeds.pulse = { items: [item("a"), item("b")] };
    expect(renderToStaticMarkup(<BottomPulseTicker />)).not.toContain("data-target-audit");
  });

  it("open-feed button, pause and snooze each declare a 44px phone box", () => {
    feeds.pulse = { items: [item("a"), item("b")] };
    const html = renderToStaticMarkup(<BottomPulseTicker />);
    const open = html.match(/<button[^>]*aria-label="Open pulse feed"[^>]*>/)?.[0] ?? "";
    const pause = html.match(/<button[^>]*aria-label="Pause rotation"[^>]*>/)?.[0] ?? "";
    const snooze = html.match(/<button[^>]*aria-label="Snooze item for a day"[^>]*>/)?.[0] ?? "";
    expect(open).toMatch(/\bmin-h-11\b/);
    expect(pause).toMatch(/\bmin-h-11\b/);
    expect(pause).toMatch(/\bmin-w-11\b/);
    // 12px glyph + 16px padding each side = 44, pulled back by -m-4 so the strip does not grow
    expect(snooze).toMatch(/[\s"]p-4[\s"]/);
    expect(snooze).toMatch(/[\s"]-m-4[\s"]/);
  });

  it("the strip's snooze is visible on touch (no hover-gated opacity-0)", () => {
    feeds.pulse = { items: [item("a")] };
    const snooze = renderToStaticMarkup(<BottomPulseTicker />).match(/<button[^>]*aria-label="Snooze item for a day"[^>]*>/)?.[0] ?? "";
    expect(snooze).not.toBe("");
    expect(snooze).not.toMatch(/(^|\s)opacity-0(\s|")/);
  });
});
