/**
 * tests/components/mobile-a11y.test.tsx · v10.0.528
 *
 * Locks down the deferred Wave-2 mobile a11y fixes from the v525 audit
 * (docs/audits/a11y-motion-perf-mobile-2026-05-12.md). The vitest env
 * is Node (no jsdom · no testing-library) so we test two ways:
 *
 *   1. SSR markup output via renderToStaticMarkup — for components
 *      that can be rendered in isolation (GlobalTopTicker hides on
 *      "/" so we read its source · BottomPulseTicker requires data ·
 *      ReasoningTrace renders cleanly with just props).
 *   2. Source-file regex assertions for the composer buttons + Send
 *      button + textarea in app/(mastery)/chat/page.tsx — rendering
 *      the whole chat page would require a streaming chat transport
 *      mock the size of which is out of scope. Asserting the literal
 *      Tailwind classname strings is enough to lock the touch-target
 *      contract.
 *
 * Five tests · covering A2 (composer ≥ 44px on mobile · two buttons +
 * Send + textarea) · A3 (ticker min-height ≥ 32px on mobile) · A6 (top
 * + bottom tickers have role="region") · A7 (reasoning-trace toggle
 * has aria-controls pointing at the disclosed contents id).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

// next/navigation pulls in the App Router runtime · stub usePathname
// so the GlobalTopTicker can be rendered in node. Returning anything
// non-"/" lets the ticker mount.
import { vi } from "vitest";
vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
}));

// The bottom ticker fetches /api/ultron/personal-pulse on mount. In
// the SSR pass `useEffect` doesn't run · the component returns null
// when data is null · so we test the top ticker's wrapper for the
// role + aria-label landmark (the bottom ticker's wrapper is read off
// the file source since SSR returns "" until data lands).
import { GlobalTopTicker } from "@/components/hud/global-top-ticker";
import { ReasoningTrace } from "@/components/chat/reasoning-trace";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readSource(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf-8");
}

// ─── 1 · A2 · composer touch targets ─────────────────────────────────

describe("A2 · composer buttons + textarea hit 44px Apple HIG on mobile", () => {
  // v10.0.529.106 · Wave 83 · the composer chrome was split out of
  // page.tsx into dedicated components · scan those files for the
  // touch-target classname contracts. Textarea stayed on page.tsx
  // so that check still reads chatSrc.
  const chatSrc = readSource("app/(mastery)/chat/page.tsx");
  const toolbarSrc = readSource("components/chat/composer-toolbar.tsx");
  const sendBtnSrc = readSource("components/chat/composer-send-button.tsx");

  it("mic + paperclip + phone buttons render w-11 h-11 on mobile (44px)", () => {
    // The three always-visible composer buttons on mobile.
    // Pattern matches the literal Tailwind classname segments.
    const mic = toolbarSrc.match(
      /shrink-0 w-11 h-11 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all/,
    );
    expect(mic).not.toBeNull();

    // Paperclip + Phone share the same w-11 h-11 sm:w-8 sm:h-8 prefix.
    // There must be at least 3 occurrences (mic + paperclip + phone).
    const occurrences = toolbarSrc.match(/w-11 h-11 sm:w-8 sm:h-8/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });

  it("Send/Stop button stays at w-11 h-11 sm:w-9 sm:h-9 (44 mobile, 36 desktop)", () => {
    // The Send/Stop button was already at 44px mobile · this asserts
    // the contract didn't regress when the other buttons were bumped.
    const send = sendBtnSrc.match(/shrink-0 relative w-11 h-11 sm:w-9 sm:h-9 rounded-xl/);
    expect(send).not.toBeNull();
  });

  it("textarea min-height is 44px on mobile, 36px on desktop", () => {
    // Was min-h-[40px] sm:min-h-[32px] — both failed Apple HIG (40 < 44)
    // and made the textarea visually shorter than the Send chip on
    // desktop. New contract: min-h-[44px] sm:min-h-[36px].
    expect(chatSrc).toContain("min-h-[44px] sm:min-h-[36px]");
    expect(chatSrc).not.toContain("min-h-[40px] sm:min-h-[32px]");
  });
});

// ─── 2 · A6 · top ticker landmark ────────────────────────────────────

describe("A6 · GlobalTopTicker has role=region + aria-label landmark", () => {
  it("renders role='region' aria-label='Live alerts' aria-live='off' on the sticky shell", () => {
    const html = renderToStaticMarkup(<GlobalTopTicker />);
    // Screen reader users get a landmark to jump to / skip past.
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Live alerts"');
    // Marquee items rotate every ~55s · we never want them announced.
    expect(html).toContain('aria-live="off"');
  });
});

// ─── 3 · A6 · bottom ticker landmark (source-level check) ────────────

describe("A6 · BottomPulseTicker source declares role=region landmark", () => {
  it("file contains role='region' + aria-label='System pulse' + aria-live='off'", () => {
    // The bottom ticker returns null when data is null (SSR · no API
    // call) so we read the source to lock the landmark contract.
    const src = readSource("components/ultron/bottom-pulse-ticker.tsx");
    expect(src).toContain('role="region"');
    expect(src).toContain('aria-label="System pulse"');
    expect(src).toContain('aria-live="off"');
  });
});

// ─── 4 · A3 · ticker container ≥ 32px on mobile ──────────────────────

describe("A3 · ticker container bumped to min-h 32px on mobile", () => {
  it("top-strip/ticker.tsx uses min-h-[32px] sm:h-5 (32 mobile, 20 desktop)", () => {
    const src = readSource("components/ultron/top-strip/ticker.tsx");
    // Was h-5 universally · now scales to 32px on mobile for HIG.
    expect(src).toContain("min-h-[32px] sm:h-5");
    // The bare h-5 outer container should be gone — replaced with the
    // responsive version above. (h-5 still appears in the empty-state
    // div's responsive sm:h-5 modifier · that's expected.)
    const bareH5 = src.match(/className="h-5 overflow-hidden/g) ?? [];
    expect(bareH5.length).toBe(0);
  });

  it("bottom-pulse-ticker.tsx uses min-h-[32px] sm:h-5 on the visible state", () => {
    const src = readSource("components/ultron/bottom-pulse-ticker.tsx");
    expect(src).toContain("min-h-[32px] sm:h-5");
  });
});

// ─── 5 · A7 · reasoning-trace aria-controls ──────────────────────────

describe("A7 · ReasoningTrace toggle has aria-controls pointing at disclosed contents", () => {
  it("the toggle button's aria-controls matches the disclosed div's id (when open)", () => {
    // Open state · the contents render with a stable id. We render
    // the closed state (default) AND check the source for the wiring
    // because in SSR the open-state mount only happens after a click.
    // Source-level check: useId() · aria-controls={contentsId} · id={contentsId}.
    const src = readSource("components/chat/reasoning-trace.tsx");
    expect(src).toContain("const contentsId = useId();");
    expect(src).toContain("aria-controls={contentsId}");
    expect(src).toContain("id={contentsId}");

    // SSR sanity · rendering the component (closed) does not throw.
    const html = renderToStaticMarkup(
      <ReasoningTrace messageId="test-msg-1" />,
    );
    // The toggle button is always in the DOM (open or closed) so the
    // aria-controls attribute must be present even when collapsed.
    expect(html).toContain("aria-controls=");
    expect(html).toContain("aria-expanded=");
    expect(html).toContain("aria-label=\"Toggle reasoning trace\"");
  });
});
